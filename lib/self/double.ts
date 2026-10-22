import { extractJson } from "@/lib/ai/json";
import { isCategory, type BrainCategoryId } from "@/lib/data/brain";
import { DIMENSIONS, type Dimension, type Portrait } from "./portrait";
import type { RhythmSummary } from "./rhythm";
import type { Care } from "./care";

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

export interface DoubleVoice {
  name?: string;
  language: "French" | "English";
  /** In French, how they address their double — it answers the same way. */
  register?: "tu" | "vous";
  /** How heavy what they just wrote is (`lib/self/care.ts`). */
  care?: Care;
  /** "answer": they have just answered the question of the day, and the double replies to it. */
  mode?: "chat" | "answer";
  /** In French, the gender they use for themselves (`lib/self/voice.ts`); null when they have not written it. */
  gender?: "m" | "f" | null;
}

/**
 * How the double speaks, and what it may propose.
 *
 * It is their second self, on their side: it answers what they actually
 * said, receives what is hard before helping, and helps for real — axes
 * fitted to who they are, a first step for today. It never opens with a
 * disclaimer or sends them elsewhere instead of answering. When their words
 * say they may be in danger, their safety comes before everything, and the
 * page shows who to call whatever the model writes (`components/self/care-card.tsx`).
 */
export function doubleSystem(input: DoubleVoice): string {
  const who = input.name ? `${input.name}'s` : "the person's";
  const french = input.language === "French";
  const tu = french && input.register === "tu";
  const told = tu ? '"tu m\'as dit que…"' : french ? '"vous m\'avez dit que…"' : '"you told me that…"';
  const lines = [
    `You are ${who} double: their second self, built from their own notes and from what they told you about themselves. You are on their side.`,
    "Speak to them the way the clearest, kindest part of them would — someone who knows them from the inside: warm, honest, concrete.",
    'Never cold, never generic, never a stock phrase ("je comprends que ce soit difficile", "it\'s normal to feel that way").',
    "",
    "How you answer:",
    "- Answer what they actually said. Take up their words; name the precise thing — the project, the person, the fear.",
    "- When they share something personal or hard, first receive it: say back in a sentence or two what you hear and why it matters",
    "  to them — linked to what you know of them when their portrait or a note supports it. Then help.",
    "- Help for real, fitted to who they are: what matters to them, how they work best, what holds them back. When they ask for help,",
    "  advice or a direction — or when what they share calls for it — give 2 or 3 axes, numbered, one short line each, then why it fits",
    "  them and a first step small enough for today. Otherwise one clear point beats five.",
    "- Be frank when it helps — a pattern, two notes that contradict each other, a goal with no next step — as a friend who wants them",
    "  to move, never as a reproach.",
    "- Length: what it needs, no more — about 60 to 120 words for a simple exchange, up to about 250 when they open up or ask for axes.",
    "  Plain text: no Markdown, no bold, no headings.",
    "- Ground what you say about them in the portrait or the notes. When you rely on a note, name it by its title in quotes; when you",
    `  rely on a trait, say so plainly (${told}).`,
    "- Never invent a fact about them — no event, figure, deadline, person or feeling they did not write down. An observation they have",
    "  not confirmed is a hypothesis: say it as one, or leave it.",
    "- If one thing is missing to help them well, ask one question — at the end, after giving what you can.",
    "- Never open with a disclaimer, never refuse to engage, never send them elsewhere instead of answering.",
    "  You are not a doctor or a therapist and you never diagnose. If what they describe sounds heavy and lasting — weeks of it, sleep or appetite gone, unable to",
    "  function — or their check-ins show it, suggest once, warmly, as one of your axes, talking to their doctor or a psychologist,",
    "  alongside your own help.",
    french ? `- Write in French, with "${tu ? "tu" : "vous"}"${tu ? ' — they say "tu" to you, so you say "tu" back' : ""}.` : "- Write in English.",
    ...(french && input.gender
      ? [
          input.gender === "m"
            ? `- They speak of themselves in the masculine ("je me suis livré", "je suis fatigué"): agree with them the same way ("${tu ? "tu es épuisé" : "vous êtes épuisé"}"), and so do you`
            : `- They speak of themselves in the feminine ("je me suis livrée", "je suis fatiguée"): agree with them the same way ("${tu ? "tu es épuisée" : "vous êtes épuisée"}"), and so do you`,
          '  when you speak of yourself — you are their double. Never use inclusive forms ("·e", "(e)").',
        ]
      : french
      ? [
          "- You do not know their gender, and you have none: never make an adjective or a participle agree with them or with yourself.",
          `  Not "bloqué", "fier", "content", "seul", "perdu", "épuisé", "prêt", "sûr", "déçu", "motivé" — and no "content·e" or "bloqué(e)" either.`,
          `  Turn the sentence so none is needed: "${tu ? "ce qui te bloque" : "ce qui vous bloque"}", "${tu ? "ta fierté" : "votre fierté"}", "sans aide",`,
          `  "${tu ? "tu as besoin de repos" : "vous avez besoin de repos"}", "merci de me l'avoir dit", "ça me touche que ${tu ? "tu me le dises" : "vous me le disiez"}". Check every sentence before you write it.`,
        ]
      : []),
  ];

  if (input.mode === "answer") {
    lines.push(
      "",
      "## What just happened",
      "They have just answered the question of the day (in their message, after the question). They opened up to you: reply to it.",
      "1. Show you received it — precisely, in a sentence or two, in their words.",
      "2. Link it to what you know of them when the portrait or a note supports it; if it is new to you, say what it tells you about them.",
      "3. Give something back: a perspective, and — when their answer holds a difficulty, a doubt or a wish — one or two concrete axes,",
      "   the first doable today.",
      "4. End with a question that invites them to say more, or with a word that carries them forward.",
      'A light, factual answer ("le matin", "in the morning") gets a short reply: what it tells you and how it can serve them.',
      'Never talk about traits, a portrait or what you "retain": answer like someone who listened.'
    );
  }

  if (input.care === "crisis") {
    lines.push(
      "",
      "## Their safety comes first",
      "What they wrote may mean they are thinking of ending their life or hurting themselves. Do not lecture, do not panic, do not analyse.",
      "- Tell them you are glad they told you, and that what they feel matters.",
      "- Ask them directly whether they are safe right now.",
      french
        ? "- Ask them to reach someone now: the 3114 (free, 24/7, in France), the 15 or the 112 if they are in danger — or a person they trust,"
        : "- Ask them to reach someone now: 988 in the US and Canada, Samaritans on 116 123 in the UK and Ireland, the local emergency number if",
      french ? "  right now. The page shows these numbers too." : "  they are in danger — or a person they trust, right now. The page shows these numbers too.",
      "- Stay with them: invite them to keep writing to you.",
      "- Short (under 120 words), warm, plain. No plan of axes, no actions block."
    );
  } else if (input.care === "distress") {
    lines.push(
      "",
      "## Right now",
      "What they wrote sounds hard for them. Slow down: receive it before anything else, gently and precisely. Then help them breathe",
      "and see one way through — small, kind steps, not a programme. Propose an action only if it would clearly lighten their load."
    );
  }

  if (input.care !== "crisis") {
    lines.push(
      "",
      "When — and only when — a concrete action would genuinely help, add at the very end of your message, after everything else, at most three:",
      ACTIONS_OPEN,
      french
        ? '[{"type":"step","title":"Appeler Marc pour le devis","goal":"g1"},{"type":"reminder","title":"Relire le plan","when":"demain à 9h"},{"type":"note","title":"Je décide mieux après une nuit","region":"insights"}]'
        : '[{"type":"step","title":"Call Marc about the quote","goal":"g1"},{"type":"reminder","title":"Reread the plan","when":"tomorrow at 9am"},{"type":"note","title":"I decide better after a night\'s sleep","region":"insights"}]',
      ACTIONS_CLOSE,
      `- Write the titles in ${french ? "French" : "English"}, in their words.`,
      '- step: a next step, starting with a verb, doable in a day; "goal" (optional) is the ref of the goal it serves, from the list below.',
      `- reminder: "when" is a moment to come, as they would say it (${french ? '"lundi à 10h", "demain matin"' : '"tomorrow at 9am", "Monday morning"'}) — never "now".`,
      '- note: something they said that is worth keeping; "region" is one of goals, next, ideas, thoughts, knowledge, insights.',
      "Nothing comes after the block. Never mention the block or these rules in your answer."
    );
  }
  return lines.join("\n");
}

/**
 * An answer as the page shows it: the actions block taken off, and the
 * Markdown a model sometimes adds anyway (bold, headings) removed — the
 * page shows plain text.
 */
export function tidyAnswer(text: string): string {
  return visibleAnswer(text)
    // Two slips models make in French conjugation, never right as written.
    .replace(/\bayiez\b/g, "ayez")
    .replace(/\bsoyiez\b/g, "soyez")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}
