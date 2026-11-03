import type { QuestionId } from "@/lib/onboarding";

/**
 * What the onboarding asks and the limits of each answer — apart from the
 * schemas in `lib/onboarding.ts`, so that the wizard and the settings show
 * them without bringing the validation library into the browser.
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

export type QuestionType = "text" | "longtext" | "multi" | "edition";

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
  // Last: suggested from the areas, and already chosen — continuing keeps it.
  { id: "edition", type: "edition", optional: true },
];
