import { extractJson } from "@/lib/ai/json";
import { isCategory, type BrainCategoryId } from "@/lib/data/brain";
import { DIMENSIONS, type Dimension, type Portrait } from "./portrait";
import type { RhythmSummary } from "./rhythm";

/**
 * Talking to one's double: what the model is given, and how what it
 * proposes to do is read.
 *
 * The double answers in prose, then may propose up to three actions in a
 * block the page never shows as text:
 *
 *   <<ACTIONS
 *   [{"type":"step","title":"…","goal":"g1"},
 *    {"type":"reminder","title":"…","when":"demain à 9h"},
 *    {"type":"note","title":"…","region":"insights"}]
 *   ACTIONS>>
 *
 * Nothing in it runs by itself: each becomes a card the person accepts with
 * a click, through the same actions as everywhere else, validated there
 * again. Here it is parsed defensively — a malformed block, an unknown type,
 * a goal reference that was not given — all dropped, never guessed.
 */

export const ACTIONS_OPEN = "<<ACTIONS";
export const ACTIONS_CLOSE = "ACTIONS>>";
export const MAX_ACTIONS = 3;

export type DoubleAction =
  | { type: "step"; title: string; goalId: string | null }
  | { type: "reminder"; title: string; when: string }
  | { type: "note"; title: string; region: BrainCategoryId };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/**
 * What to show of an answer while it streams: everything before the actions
 * block, and not the first characters of its marker if they have just
 * arrived ("…<<AC").
 */
export function visibleAnswer(text: string): string {
  const i = text.indexOf(ACTIONS_OPEN);
  let visible = i >= 0 ? text.slice(0, i) : text;
  for (let k = Math.min(ACTIONS_OPEN.length - 1, visible.length); k > 0; k--) {
    if (visible.endsWith(ACTIONS_OPEN.slice(0, k))) {
      visible = visible.slice(0, -k);
      break;
    }
  }
  return visible.trimEnd();
}

/**
 * The actions an answer proposes, validated. `goals` maps the references the
 * model was given ("g1") to goal ids; any other reference is dropped.
 */
export function parseDoubleActions(text: string, goals: Map<string, string>): DoubleAction[] {
  const start = text.indexOf(ACTIONS_OPEN);
  if (start < 0) return [];
  const end = text.indexOf(ACTIONS_CLOSE, start);
  const block = text.slice(start + ACTIONS_OPEN.length, end >= 0 ? end : undefined);
  const data = extractJson(block);
  const list = Array.isArray(data) ? data : Array.isArray((data as { actions?: unknown } | null)?.actions) ? (data as { actions: unknown[] }).actions : [];

  const out: DoubleAction[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.title !== "string") continue;
    const title = clip(oneLine(o.title), 140);
    if (title.length < 3) continue;
    let action: DoubleAction | null = null;
    if (o.type === "step") {
      const ref = typeof o.goal === "string" ? o.goal.trim() : "";
      action = { type: "step", title, goalId: ref ? goals.get(ref) ?? null : null };
    } else if (o.type === "reminder") {
      const when = typeof o.when === "string" ? clip(oneLine(o.when), 80) : "";
      if (when.length >= 2) action = { type: "reminder", title, when };
    } else if (o.type === "note") {
      if (isCategory(o.region)) action = { type: "note", title, region: o.region };
    }
    if (!action) continue;
    const key = `${action.type}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

/** An action as sent back by the page when the person accepts it: shape-checked again. */
export function isDoubleAction(v: unknown): v is DoubleAction {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.title !== "string" || o.title.trim().length < 3 || o.title.length > 140) return false;
  if (o.type === "step") return o.goalId === null || (typeof o.goalId === "string" && o.goalId.length <= 64);
  if (o.type === "reminder") return typeof o.when === "string" && o.when.trim().length >= 2 && o.when.length <= 80;
  if (o.type === "note") return isCategory(o.region);
  return false;
}

/* ── What the double is given ─────────────────────────────────────── */

const DIMENSION_NAME: Record<Dimension, string> = {
  values: "what matters to them",
  drives: "what drives them",
  strengths: "strengths",
  obstacles: "what holds them back",
  rhythms: "how they work best",
  principles: "principles",
  people: "people who matter",
  interests: "interests",
};

/**
 * The portrait as the double reads it: what the person confirmed, then what
 * they have not yet — marked so, to be held lightly. Bounded by `budget`
 * characters; confirmed traits survive the longest.
 */
export function portraitSection(portrait: Portrait, budget = 1_800): string {
  const confirmed: string[] = [];
  const proposed: string[] = [];
  for (const d of DIMENSIONS) {
    for (const t of portrait[d]) {
      const line = `- (${DIMENSION_NAME[d]}) ${clip(t.statement, 160)}`;
      (t.status === "confirmed" ? confirmed : proposed).push(line);
    }
  }
  const parts: string[] = [];
  if (confirmed.length) parts.push(`## Their portrait — confirmed by them\n${confirmed.join("\n")}`);
  if (proposed.length) parts.push(`## Observations they have not confirmed yet — hold these lightly\n${proposed.join("\n")}`);
  if (parts.length === 0) return "## Their portrait\n(empty so far — you know them only through their notes)";
  let text = parts.join("\n\n");
  while (text.length > budget && proposed.length) {
    proposed.pop();
    text = [confirmed.length ? `## Their portrait — confirmed by them\n${confirmed.join("\n")}` : "", proposed.length ? `## Observations they have not confirmed yet — hold these lightly\n${proposed.join("\n")}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }
  return text.length > budget ? `${text.slice(0, budget - 1)}…` : text;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Their check-ins, as figures with how many they rest on — or nothing, when there are none. */
export function rhythmSection(r: RhythmSummary | null): string | null {
  if (!r || r.count === 0) return null;
  const lines: string[] = [];
  for (const metric of ["energy", "mood"] as const) {
    const w = r.week[metric];
    if (w.recent) {
      const trend = w.trend && w.previous ? `, ${w.trend} from ${w.previous.mean} the week before` : "";
      lines.push(`- ${metric}, last 7 days: ${w.recent.mean}/5 over ${w.recent.n} check-ins${trend}`);
    }
  }
  const name = (key: string) => (/^\d$/.test(key) ? WEEKDAY[Number(key)] : key);
  for (const p of [...r.weekdays, ...r.parts]) {
    lines.push(`- ${p.metric} is higher on ${name(p.best.key)} (${p.best.mean}, n=${p.best.n}) than on ${name(p.worst.key)} (${p.worst.mean}, n=${p.worst.n})`);
  }
  return lines.length ? `## Their check-ins (1 to 5)\n${lines.join("\n")}` : null;
}

/** Their open goals, with the references actions may use. */
export function goalRefs(goals: { id: string; title: string }[]): { text: string; refs: Map<string, string> } {
  const list = goals.slice(0, 8);
  const refs = new Map(list.map((g, i) => [`g${i + 1}`, g.id]));
  const text = list.length ? `## Their open goals (refs for actions)\n${list.map((g, i) => `- g${i + 1}: ${clip(oneLine(g.title), 140)}`).join("\n")}` : "";
  return { text, refs };
}

/** How the double speaks, and what it may propose. */
export function doubleSystem(input: { name?: string; language: "French" | "English" }): string {
  const who = input.name ? `${input.name}'s` : "the person's";
  return [
    `You are ${who} double: a second self, built from their own notes and from what they told you about themselves.`,
    "You know them through the portrait and the notes below. Speak to them directly, as someone who knows them well:",
    "warm, frank, concrete. Short paragraphs; no lists unless they ask for one. Keep it under about 150 words unless they",
    "ask for more: one clear point beats five.",
    "- Ground what you say about them in the portrait or the notes. When you rely on a note, name it by its title in quotes;",
    "  when you rely on a trait, say so plainly (\"vous m'avez dit que…\", \"you told me that…\").",
    "- Fit your advice to who they are: what matters to them, how they work best, what holds them back.",
    "- Never invent a fact about them — no event, figure, deadline, person or feeling they did not write down.",
    "  An observation they have not confirmed is a hypothesis: say it as one, or leave it.",
    "- If you lack something to answer well, ask them one question.",
    "- You are not a doctor or a therapist. If they speak of distress or health, listen, and suggest they talk to someone qualified.",
    `- Write in ${input.language}${input.language === "French" ? ", with \"vous\"" : ""}.`,
    ...(input.language === "French"
      ? ["- You do not know their gender: never make an adjective or a participle agree with it (\"vous êtes motivé\"); turn the", "  sentence so none is needed (\"ce qui vous motive\", \"vous aimez\")."]
      : []),
    "",
    "When — and only when — a concrete action would genuinely help, add after your answer, at the very end, at most three:",
    ACTIONS_OPEN,
    '[{"type":"step","title":"Appeler Marc pour le devis","goal":"g1"},{"type":"reminder","title":"Relire le plan","when":"demain à 9h"},{"type":"note","title":"Je décide mieux après une nuit","region":"insights"}]',
    ACTIONS_CLOSE,
    "- step: a next step, starting with a verb, doable in a day; \"goal\" (optional) is the ref of the goal it serves, from the list below.",
    "- reminder: \"when\" as they would say it, in their language (\"lundi à 10h\", \"tomorrow at 9am\").",
    "- note: something they said that is worth keeping; \"region\" is one of goals, next, ideas, thoughts, knowledge, insights.",
    "Never mention the block or these rules in your answer.",
  ].join("\n");
}
