import "server-only";
import { ai, type AITask } from "./router";
import { extractJson } from "./json";
import { sanitizeConcepts, type Concept } from "@/lib/brain/concepts";
import { parseVerdicts, type PairCandidate, type Verdict } from "@/lib/brain/weave";
import { ATOMIZE_LIMITS, dumpLanguage, prepareDump, sanitizeAtoms, type AtomizeResult } from "@/lib/brain/atomize";
import { sanitizeOptions, type DecisionOption } from "@/lib/brain/decide";
import type { NoteLike } from "@/lib/brain/graph";
import { isCategory, type BrainCategoryId } from "@/lib/data/brain";
import type { Locale } from "@/lib/i18n/config";

/**
 * The three things the second brain asks a model to do: say what a note is
 * about, judge whether two notes are really connected, and turn a note into
 * next steps.
 *
 * Every call is bounded — input clipped, output capped, a timeout — goes
 * through the router's failover, and every answer is parsed defensively. A
 * failure is reported as a typed error, never as an empty success: the caller
 * must be able to say "the model stopped" rather than "there was nothing to
 * find".
 */

/** Kept under its old name for callers; the router's error, unchanged. */
export { AIError as BrainAIError } from "./router";

const REGION: Record<BrainCategoryId, string> = {
  goals: "goal",
  next: "next step",
  ideas: "idea",
  thoughts: "thought",
  knowledge: "knowledge",
  insights: "insight",
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const languageOf = (locale: Locale) => (locale === "fr" ? "French" : "English");

/** "[goal] Sign 10 clients — detail…" — what a model sees of a note. */
function describe(n: Pick<NoteLike, "category" | "title" | "detail">, detailChars: number): string {
  const detail = n.detail ? oneLine(n.detail) : "";
  return `[${REGION[n.category]}] ${clip(oneLine(n.title), 200)}${detail ? ` — ${clip(detail, detailChars)}` : ""}`;
}

/**
 * A JSON completion through the router: the task picks the model tier,
 * failover and rate-limit rests are handled there. `accept` rejects answers
 * that parse but are unusable, so the next model is asked instead.
 */
async function completeJson(opts: {
  task: AITask;
  system: string;
  user: string;
  /**
   * Sized to the answer, not generously: providers count the requested
   * maximum against the per-minute token quota. Reasoning headroom for the
   * models that need it is added by the router.
   */
  maxTokens: number;
  temperature: number;
  accept?: (data: unknown) => boolean;
}): Promise<string> {
  const { value } = await ai().complete({
    task: opts.task,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    json: true,
    validate: opts.accept ? (text) => opts.accept!(extractJson(text)) : (text) => extractJson(text) !== null,
  });
  return value;
}

/* ── 1. What a note is about ──────────────────────────────────────── */

const CONCEPTS_SYSTEM = [
  "You index the notes of one person's second brain, so that notes about the same thing can find each other",
  "even when they use different words or different languages.",
  "",
  "For each note, give 2 to 5 concepts that say specifically what it is about.",
  "- A concept is a short noun phrase of 1 to 3 words: a subject, a method, a domain, or a named entity",
  "  (a person, company, product, place, channel).",
  "- Prefer the phrasing another note on the same subject would also get: \"customer acquisition\", \"referral program\",",
  "  \"cash flow\", \"marc\", \"linkedin ads\" — not vague umbrellas like \"growth\" or \"strategy\" on their own.",
  "- Never use: idea, note, thought, task, goal, plan, project, work, business, life, thing, next step.",
  "- For each concept return \"k\": the canonical key in English, lowercase and singular; and \"l\": the same concept",
  "  as it would be written in the note's own language, lowercase. Names stay names in both.",
  "",
  "Answer with JSON only: {\"notes\":[{\"id\":\"n1\",\"concepts\":[{\"k\":\"referral program\",\"l\":\"parrainage\"}]}]}",
  "with one entry per note, using the ids given.",
].join("\n");

/**
 * Concepts for up to 20 notes in one call. Only notes the model actually
 * answered for are returned: an omitted note must be retried later, not be
 * recorded as having no concepts.
 */
export async function extractConcepts(
  notes: NoteLike[],
  /**
   * Keys already used in this brain, most frequent first. Offered to the
   * model so the same subject gets the same key — without them, one note
   * said "client acquisition" and the next "customer acquisition", and the
   * two never met.
   */
  knownKeys: string[] = []
): Promise<Map<string, Concept[]>> {
  const batch = notes.slice(0, 20);
  if (batch.length === 0) return new Map();
  const shortIds = new Map(batch.map((n, i) => [`n${i + 1}`, n.id]));
  const known = knownKeys.slice(0, 60);

  const raw = await completeJson({
    task: "concepts",
    system: CONCEPTS_SYSTEM,
    accept: (d) => Array.isArray((d as { notes?: unknown } | null)?.notes) || Array.isArray(d),
    user: [
      ...(known.length
        ? [`Keys already in use — reuse one exactly when it means the same thing: ${known.join(", ")}`, ""]
        : []),
      ...batch.map((n, i) => `n${i + 1} ${describe(n, 300)}`),
    ].join("\n"),
    maxTokens: 70 * batch.length + 60,
    temperature: 0.1,
  });

  const data = extractJson(raw) as { notes?: unknown } | unknown[] | null;
  const list = Array.isArray(data) ? data : Array.isArray((data as { notes?: unknown })?.notes) ? (data as { notes: unknown[] }).notes : [];
  const out = new Map<string, Concept[]>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as { id?: unknown; concepts?: unknown };
    const id = typeof o.id === "string" ? shortIds.get(o.id.trim()) : undefined;
    if (id && !out.has(id)) out.set(id, sanitizeConcepts(o.concepts));
  }
  return out;
}

/* ── 1b. Which region a thought belongs to ────────────────────────── */

const REGIONS_SYSTEM = [
  "You file the notes of one person's second brain. For each numbered note, choose its region:",
  "goals (an outcome to reach), next (a concrete action to do), ideas (a proposal or possibility),",
  "thoughts (a reflection, feeling or observation about oneself), knowledge (a fact, figure or reference),",
  "insights (a realisation or lesson drawn from experience).",
  "Answer with JSON only: {\"regions\":[\"ideas\",\"thoughts\"]} — one region per note, in order.",
].join("\n");

/**
 * Regions for several short texts in one call, in order. Entries the model
 * got wrong or left out come back as null, for the caller's own fallback.
 */
export async function classifyTexts(texts: string[]): Promise<(BrainCategoryId | null)[]> {
  if (texts.length === 0) return [];
  const raw = await completeJson({
    task: "classify",
    system: REGIONS_SYSTEM,
    accept: (d) => Array.isArray((d as { regions?: unknown } | null)?.regions),
    user: texts.map((t, i) => `${i + 1}. ${clip(oneLine(t), 300)}`).join("\n"),
    maxTokens: 12 * texts.length + 30,
    temperature: 0,
  });
  const data = extractJson(raw) as { regions?: unknown } | null;
  const list = Array.isArray(data?.regions) ? data.regions : [];
  return texts.map((_, i) => (isCategory(list[i]) ? list[i] : null));
}

/* ── 2. Are two notes really connected? ───────────────────────────── */

function judgeSystem(locale: Locale): string {
  return [
    "You are the connection engine of one person's second brain. For each numbered pair of their notes (A and B),",
    "decide whether a meaningful, specific connection exists — one the person would be glad to see drawn.",
    "",
    "Connect only when one of these holds:",
    "- advances: one note is a concrete action, plan or idea that would move the other (a goal or an intention) forward.",
    "- supports: one note is a fact, figure, lesson or reason that backs or informs the other.",
    "- extends: one note develops, refines or follows up the other.",
    "- tension: the notes contradict each other, or compete for the same limited time, money or attention.",
    "- related: they are about the same specific subject and none of the above fits.",
    "Do not connect notes that merely share a broad theme (both about work, business or health) or a common word.",
    "When unsure, do not connect. Most pairs should not be connected.",
    "",
    "\"from\" is \"A\" or \"B\": the note that advances, supports or extends the other. For tension and related it is null.",
    "\"confidence\" is the probability, from 0 to 1, that the person would agree with the connection.",
    `"reason" is one short sentence in ${languageOf(locale)}, under 110 characters, that names the actual link between`,
    "these two notes without repeating their titles.",
    "",
    "Answer with JSON only, one entry per pair:",
    "{\"verdicts\":[{\"pair\":1,\"connect\":true,\"kind\":\"advances\",\"from\":\"A\",\"confidence\":0.84,\"reason\":\"...\"}]}",
    "For a pair that should not be connected: {\"pair\":2,\"connect\":false}.",
  ].join("\n");
}

export async function judgePairs(
  pairs: PairCandidate[],
  notesById: Map<string, NoteLike>,
  locale: Locale
): Promise<Verdict[]> {
  const lines: string[] = [];
  pairs.forEach((p, i) => {
    const a = notesById.get(p.a);
    const b = notesById.get(p.b);
    if (!a || !b) return;
    lines.push(`Pair ${i + 1}`, `A: ${describe(a, 220)}`, `B: ${describe(b, 220)}`, "");
  });
  if (lines.length === 0) return [];

  const raw = await completeJson({
    task: "judge",
    system: judgeSystem(locale),
    accept: (d) => Array.isArray((d as { verdicts?: unknown } | null)?.verdicts) || Array.isArray(d),
    user: lines.join("\n"),
    maxTokens: 60 * pairs.length + 60,
    temperature: 0.1,
  });
  return parseVerdicts(raw, pairs.length);
}

/* ── 1b. What a question is about ─────────────────────────────────── */

const SUBJECTS_SYSTEM = [
  "You map a question to the subjects of one person's second brain.",
  "From the list of subject keys, pick the ones the question is about, or whose notes would help answer it —",
  "at most 4, most relevant first. Copy keys exactly from the list; never write a key that is not in it.",
  "If none fits, return an empty list.",
  "Answer with JSON only: {\"keys\":[\"...\"]}",
].join("\n");

/**
 * A question's subjects, chosen from the keys the brain already uses — so the
 * question can find notes it shares no word with ("how do I grow revenue?"
 * meets the notes about client acquisition).
 *
 * A choice from a closed list, not an extraction: asked to describe the
 * question freely, the model named subjects the brain did not have ("revenue
 * growth") and nothing matched. Keys outside the list are discarded.
 *
 * Bounded in time: the answer waits on it, and a slow or failed mapping only
 * means the question is matched on its words, as before. Never throws.
 */
export async function subjectsOfQuestion(
  question: string,
  known: { k: string; l: string }[],
  timeoutMs = 3_000
): Promise<Concept[]> {
  const q = question.trim();
  if (known.length === 0 || q.length < 4) return [];
  const list = known.slice(0, 150);
  const byKey = new Map(list.map((c) => [c.k, c]));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Concept[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  const mapped = completeJson({
    task: "classify",
    system: SUBJECTS_SYSTEM,
    accept: (d) => Array.isArray((d as { keys?: unknown } | null)?.keys),
    user: [`SUBJECTS: ${list.map((c) => c.k).join(" | ")}`, "", `QUESTION: ${clip(oneLine(q), 400)}`].join("\n"),
    maxTokens: 80,
    temperature: 0,
  })
    .then((raw) => {
      const keys = (extractJson(raw) as { keys?: unknown } | null)?.keys;
      if (!Array.isArray(keys)) return [];
      const picked = keys
        .filter((k): k is string => typeof k === "string")
        .map((k) => byKey.get(k.trim().toLowerCase()) ?? byKey.get(k.trim()))
        .filter((c): c is Concept => !!c);
      return [...new Map(picked.map((c) => [c.k, c])).values()].slice(0, 4);
    })
    .catch(() => [] as Concept[]);
  try {
    return await Promise.race([mapped, late]);
  } finally {
    clearTimeout(timer);
  }
}

/* ── 2b. A brain dump, split into atomic notes ─────────────────────── */

const ATOMIZE_SYSTEM = [
  "You turn one person's brain dump — the transcript of a voice memo, or notes they pasted — into atomic notes",
  "for their second brain.",
  "- One idea, fact, intention, worry or question per note. Split compound sentences; merge what is said twice;",
  "  drop filler (euh, bon, voilà, um, you know) and false starts.",
  "- Write each note in the dump's own language, as the person would jot it down: a next step starts with its verb",
  "  (\"Appeler Marc lundi pour le devis\", \"Call Marc on Monday about the quote\"); anything else stays in their",
  "  first person (\"Je travaille mieux le matin\"). Self-contained, under 140 characters.",
  "- Faithful above all. Every note comes from something they said: never add an action, advice, conclusion,",
  "  fact, name, figure or date they did not state — a next step only when they said they must, will or want to",
  "  do it. Keep their certainty exactly: what they could, should or might do stays \"could\", \"should\", \"maybe\"",
  "  (\"je pourrais\", \"je devrais\", \"peut-être\"); a possibility is never turned into a decision, and is filed",
  "  as an idea.",
  "- Put specifics that do not fit the title in \"detail\" (optional, short, also their words).",
  "- \"said\" quotes, word for word, the part of the dump the note comes from (its main sentence).",
  "- \"region\" is one of: goals (an outcome they want), next (an action they have decided to take), ideas (a",
  "  proposal or possibility), thoughts (a feeling or reflection), knowledge (a fact, figure or reference),",
  "  insights (a realisation about themselves or their work).",
  "- Do not create a note that only repeats one of their existing goals.",
  "- \"relations\" link these notes to each other only, and only where the dump itself makes the link — a",
  "  \"because\", \"so\", \"but\", \"at the same time\", \"that would help\" — never through an assumption of yours",
  "  (such as one project needing another). Two things they want that compete for the same money, time or",
  "  attention, joined by a \"but\" or an \"at the same time\", are a tension. Each kind names its ends by role,",
  "  so the direction is explicit:",
  "  advances {\"step\", \"goal\"}: the step moves the goal forward.",
  "  supports {\"evidence\", \"claim\"}: the evidence is a fact or reason that backs the claim",
  "  (\"Our best clients come from referrals\" is evidence for the claim \"Start a referral programme\").",
  "  extends {\"development\", \"base\"}: the development builds on the base.",
  "  tension {\"notes\": [x, y]}: the two pull against each other.",
  "  Numbers are the notes' order in your list, from 1. \"said\" quotes the dump's exact words that make the link",
  "  (join two distant fragments with …); no quote, no relation. \"reason\" is one short sentence explaining it.",
  "- At most 12 notes.",
  "Answer with JSON only:",
  "{\"notes\":[{\"title\":\"...\",\"detail\":\"...\",\"region\":\"next\",\"said\":\"...\"}],",
  " \"relations\":[{\"kind\":\"advances\",\"step\":2,\"goal\":1,\"said\":\"...\",\"reason\":\"...\"},",
  "  {\"kind\":\"supports\",\"evidence\":4,\"claim\":3,\"said\":\"...\",\"reason\":\"...\"},",
  "  {\"kind\":\"tension\",\"notes\":[5,6],\"said\":\"... … ...\",\"reason\":\"...\"}]}",
].join("\n");

/** A brain dump, split by the model and validated by `sanitizeAtoms`. */
export async function atomizeDump(input: { text: string; goals: NoteLike[]; locale: Locale }): Promise<AtomizeResult> {
  const text = prepareDump(input.text);
  if (!text) return { atoms: [], relations: [] };
  const goals = input.goals.slice(0, 8);
  const language = languageOf(dumpLanguage(text) ?? input.locale);

  const raw = await completeJson({
    task: "atomize",
    system: ATOMIZE_SYSTEM,
    accept: (d) => sanitizeAtoms(d, ATOMIZE_LIMITS.atoms, text).atoms.length > 0,
    user: [
      ...(goals.length ? ["THEIR EXISTING GOALS (context — do not repeat them as notes)", ...goals.map((g) => `- ${clip(oneLine(g.title), 160)}`), ""] : []),
      `LANGUAGE: ${language} — write every note, detail and reason in ${language}.`,
      "",
      "BRAIN DUMP",
      text,
    ].join("\n"),
    maxTokens: 1_400,
    temperature: 0.2,
  });
  return sanitizeAtoms(extractJson(raw), ATOMIZE_LIMITS.atoms, text);
}

/* ── 3. From a note to next steps ─────────────────────────────────── */

function stepsSystem(locale: Locale): string {
  return [
    "You help one person turn a note from their second brain into action.",
    "Propose 3 to 5 next steps that would move the note forward.",
    "- Each step is concrete and specific, doable in a day or two, starts with a verb, and is under 90 characters.",
    "- Build on what their related notes say (names, figures, channels). Do not repeat a step they already have.",
    "- No generic advice such as \"do research\", \"make a plan\" or \"stay motivated\".",
    `- Write in ${languageOf(locale)}.`,
    "Answer with JSON only: {\"steps\":[\"...\",\"...\"]}",
  ].join("\n");
}

export async function proposeSteps(input: {
  note: NoteLike;
  related: NoteLike[];
  existingSteps: NoteLike[];
  goals: NoteLike[];
  locale: Locale;
}): Promise<string[]> {
  const { note, related, existingSteps, goals, locale } = input;
  const section = (title: string, list: NoteLike[], chars: number) =>
    list.length ? [title, ...list.map((n) => `- ${describe(n, chars)}`), ""] : [];

  const raw = await completeJson({
    task: "steps",
    system: stepsSystem(locale),
    accept: (d) => Array.isArray((d as { steps?: unknown } | null)?.steps) || Array.isArray(d),
    user: [
      "NOTE",
      describe(note, 1200),
      "",
      ...section("CONNECTED NOTES", related.slice(0, 8), 240),
      ...section("NEXT STEPS THEY ALREADY HAVE", existingSteps.slice(0, 10), 0),
      ...section("THEIR OPEN GOALS", goals.slice(0, 5), 0),
    ].join("\n"),
    maxTokens: 320,
    temperature: 0.4,
  });

  const data = extractJson(raw) as { steps?: unknown } | unknown[] | null;
  const list = Array.isArray(data) ? data : Array.isArray((data as { steps?: unknown })?.steps) ? (data as { steps: unknown[] }).steps : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    if (typeof s !== "string") continue;
    const step = clip(oneLine(s).replace(/^[-*•\d.)\s]+/, ""), 140);
    const key = step.toLowerCase();
    if (step.length < 4 || seen.has(key)) continue;
    seen.add(key);
    out.push(step);
    if (out.length === 5) break;
  }
  return out;
}

/* ── 4. From a tension to a decision ──────────────────────────────── */

function decideSystem(locale: Locale): string {
  return [
    "You help one person decide between two notes of their second brain that pull against each other (A and B).",
    "Propose 2 or 3 decisions they could take — each concrete, one sentence, written as their own decision",
    "(\"Je garde…\", \"Je reporte…\", \"I will…\"), under 140 characters.",
    "- Ground every option in what their notes say: the two notes, what each is connected to, their goals.",
    "- Never invent a fact, figure, date, price or person that is not in the notes.",
    "- At least one option should keep something of both sides when the notes allow it.",
    "- If the notes do not say enough to decide, make one option the thing to find out first.",
    "- \"why\" is one short sentence naming the note of theirs that supports the option by what it says — never",
    "  call a note \"A\" or \"B\": the person will read this later, saved with the decision, without those labels.",
    `- Write in ${languageOf(locale)}.`,
    "Answer with JSON only: {\"options\":[{\"title\":\"...\",\"why\":\"...\"}]}",
  ].join("\n");
}

export async function proposeDecisions(input: {
  a: NoteLike;
  b: NoteLike;
  /** Why they are in tension, if the connection says. */
  reason: string | null;
  aConnected: NoteLike[];
  bConnected: NoteLike[];
  goals: NoteLike[];
  locale: Locale;
}): Promise<DecisionOption[]> {
  const { a, b, reason, aConnected, bConnected, goals, locale } = input;
  const section = (title: string, list: NoteLike[], chars: number) =>
    list.length ? [title, ...list.map((n) => `- ${describe(n, chars)}`), ""] : [];

  const raw = await completeJson({
    task: "decide",
    system: decideSystem(locale),
    accept: (d) => sanitizeOptions(d).length > 0,
    user: [
      `A: ${describe(a, 600)}`,
      ...section("CONNECTED TO A", aConnected.slice(0, 6), 200),
      `B: ${describe(b, 600)}`,
      ...section("CONNECTED TO B", bConnected.slice(0, 6), 200),
      ...(reason ? [`WHY THEY PULL AGAINST EACH OTHER: ${clip(oneLine(reason), 200)}`, ""] : []),
      ...section("THEIR OPEN GOALS", goals.slice(0, 5), 0),
    ].join("\n"),
    maxTokens: 450,
    temperature: 0.3,
  });
  return sanitizeOptions(extractJson(raw));
}
