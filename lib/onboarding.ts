import { z } from "zod";
import { normalize } from "@/lib/brain/text";
import type { BrainCategoryId } from "@/lib/data/brain";

/**
 * Onboarding: seven questions that build a second brain on the spot.
 *
 * It used to ask ten questions whose only job was to pick Notion templates —
 * and then threw eight of the answers away. Now every answer lands somewhere
 * the person can see and change:
 *
 *   name, profession, areas  → the profile (the assistant knows who you are)
 *   goal, second goal        → goal notes
 *   next step                → a next-step note, connected to the first goal
 *   what's on your mind      → one note per line, filed by region
 *
 * Nothing needs Notion. Notion is an optional export, from Settings.
 */

/** Parts of life the brain should help with. Stable ids; labels live in i18n. */
export const AREA_IDS = [
  "clients", "projects", "money", "learning", "health", "creating", "team", "personal",
] as const;
export type AreaId = (typeof AREA_IDS)[number];

export const LIMITS = {
  name: 60,
  profession: 120,
  goal: 200,
  step: 200,
  mind: 2_000,
  /** One note per line; a wall of text past this is better captured later. */
  mindLines: 8,
  /** Matches the brain's own title limit. */
  noteTitle: 500,
} as const;

const optionalText = (max: number) => z.string().trim().max(max).default("");

export const onboardingSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  profession: z.string().trim().min(1).max(LIMITS.profession),
  goal: z.string().trim().min(1).max(LIMITS.goal),
  step: optionalText(LIMITS.step),
  goal2: optionalText(LIMITS.goal),
  mind: optionalText(LIMITS.mind),
  areas: z.array(z.enum(AREA_IDS)).max(AREA_IDS.length).default([]),
});

export type OnboardingAnswers = z.infer<typeof onboardingSchema>;
/** What the wizard holds while it is being filled in. */
export type OnboardingDraft = Partial<z.input<typeof onboardingSchema>>;
export type QuestionId = keyof OnboardingAnswers;

export type QuestionType = "text" | "longtext" | "multi";

export interface Question {
  id: QuestionId;
  type: QuestionType;
  optional?: boolean;
  max?: number;
}

/** Order matters: the next step is asked right after the goal it serves. */
export const questions: Question[] = [
  { id: "name", type: "text", max: LIMITS.name },
  { id: "profession", type: "text", max: LIMITS.profession },
  { id: "goal", type: "text", max: LIMITS.goal },
  { id: "step", type: "text", optional: true, max: LIMITS.step },
  { id: "goal2", type: "text", optional: true, max: LIMITS.goal },
  { id: "mind", type: "longtext", optional: true, max: LIMITS.mind },
  { id: "areas", type: "multi", optional: true },
];

/* ── Profile answers ──────────────────────────────────────────────── */

/**
 * The part of the answers kept on the profile. Only what has no home in the
 * brain: goals and thoughts become notes, and live there alone.
 */
export const profileAnswersSchema = z.object({
  areas: z.array(z.enum(AREA_IDS)).default([]),
});
export type ProfileAnswers = z.infer<typeof profileAnswersSchema>;

/** Reads stored answers defensively: a malformed row yields defaults, not a crash. */
export function readProfileAnswers(raw: unknown): ProfileAnswers {
  const parsed = profileAnswersSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  // Keep whichever areas are still valid rather than dropping them all.
  const areas = (raw as { areas?: unknown })?.areas;
  return {
    areas: Array.isArray(areas) ? areas.filter((a): a is AreaId => (AREA_IDS as readonly string[]).includes(a)) : [],
  };
}

/* ── The starting brain ───────────────────────────────────────────── */

export interface StarterNote {
  /** Stable handle for wiring links within the plan. */
  key: string;
  title: string;
  category: BrainCategoryId;
}

export interface StarterPlan {
  notes: StarterNote[];
  /** Pairs of `StarterNote.key`. */
  links: [string, string][];
}

/**
 * "What's on your mind" → one thought per line.
 *
 * List markers are stripped ("- ", "• ", "1. ", "[ ] "), blank lines and
 * repeats are dropped, and the count is capped: onboarding seeds the brain, it
 * is not a bulk import.
 */
export function splitThoughts(mind: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of mind.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:[-*•–]|\d+[.)]|\[[ xX]?\])\s*/, "")
      .trim()
      .slice(0, LIMITS.noteTitle);
    const key = normalize(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length === LIMITS.mindLines) break;
  }
  return out;
}

/**
 * The notes and connections onboarding creates. Pure, so it can be tested and
 * so the action applying it has nothing to decide.
 *
 * Titles are unique within the plan (compared without case or accents): a
 * second goal that repeats the first, or a thought that repeats the goal, is
 * not a second note.
 */
export function starterBrain(
  a: OnboardingAnswers,
  classify: (text: string) => BrainCategoryId
): StarterPlan {
  const notes: StarterNote[] = [];
  const taken = new Set<string>();
  const add = (key: string, title: string, category: BrainCategoryId): boolean => {
    const k = normalize(title);
    if (!k || taken.has(k)) return false;
    taken.add(k);
    notes.push({ key, title, category });
    return true;
  };

  add("goal", a.goal, "goals");
  const links: [string, string][] = [];
  if (a.step && add("step", a.step, "next")) links.push(["step", "goal"]);
  if (a.goal2) add("goal2", a.goal2, "goals");
  splitThoughts(a.mind).forEach((line, i) => add(`mind${i}`, line, classify(line)));

  return { notes, links };
}
