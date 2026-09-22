import "server-only";
import type OpenAI from "openai";
import { getAI } from "./client";
import { extractJson } from "./json";
import { sanitizeConcepts, type Concept } from "@/lib/brain/concepts";
import { parseVerdicts, type PairCandidate, type Verdict } from "@/lib/brain/weave";
import type { NoteLike } from "@/lib/brain/graph";
import { isCategory, type BrainCategoryId } from "@/lib/data/brain";
import type { Locale } from "@/lib/i18n/config";

/**
 * The three things the second brain asks a model to do: say what a note is
 * about, judge whether two notes are really connected, and turn a note into
 * next steps.
 *
 * Every call is bounded — input clipped, output capped, one retry, a timeout —
 * and every answer is parsed defensively. A failure is reported as a typed
 * error, never as an empty success: the caller must be able to say "the model
 * stopped" rather than "there was nothing to find".
 */

export class BrainAIError extends Error {
  constructor(
    public readonly code: "unavailable" | "rate_limit" | "failed",
    message: string
  ) {
    super(message);
  }
}

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

async function completeJson(opts: {
  system: string;
  user: string;
  /**
   * Sized to the answer, not generously: providers count the requested
   * maximum against the per-minute token quota, so an inflated one triggers
   * rate limits — and the SDK's silent retry turned a 400 ms call into 30 s.
   */
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const ai = getAI();
  if (!ai) throw new BrainAIError("unavailable", "No AI provider is configured.");

  // Qwen3 models reason aloud unless told not to; that costs tokens and can
  // cut the JSON off at the output limit.
  const user = /qwen3/i.test(ai.model) ? `${opts.user}\n\n/no_think` : opts.user;
  try {
    const completion = await ai.client.chat.completions.create(
      {
        model: ai.model,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: user },
        ],
      },
      // No retry. On a rate limit the SDK would wait out the provider's
      // retry-after — up to a minute of a spinner — before failing anyway.
      // Better to say "try again in a minute" at once; nothing is lost.
      { timeout: 30_000, maxRetries: 0 }
    );
    return completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    const status = (err as InstanceType<typeof OpenAI.APIError>)?.status;
    // 413 is how Groq's free tier says "too many tokens for this minute".
    if (status === 429 || status === 413) {
      // The provider's own wording ("Limit 8000, Used 6100, Requested 2400")
      // goes to the logs; the person is told to try again in a minute.
      throw new BrainAIError("rate_limit", err instanceof Error ? err.message : "The model's rate limit was reached.");
    }
    throw new BrainAIError("failed", err instanceof Error ? err.message : "The model call failed.");
  }
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
    system: CONCEPTS_SYSTEM,
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
    system: REGIONS_SYSTEM,
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
    system: judgeSystem(locale),
    user: lines.join("\n"),
    maxTokens: 60 * pairs.length + 60,
    temperature: 0.1,
  });
  return parseVerdicts(raw, pairs.length);
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
    system: stepsSystem(locale),
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
