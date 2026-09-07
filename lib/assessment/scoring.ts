import {
  items, LIKERT_MIN, LIKERT_MAX, ATTENTION_CHECK, ATTENTION_CHECK_EXPECTED,
  type Domain, type Item,
} from "./instrument";

export type Responses = Record<string, number>;

export interface DomainScores {
  O: number; C: number; E: number; A: number; N: number;
}

export interface CalibrationScores {
  autonomy: number;
  risk: number;
  comms: number;
}

export interface AssessmentResult {
  /** Big Five domain means, 1–5. */
  domains: DomainScores;
  /** Operational axes, 1–5. */
  calibration: CalibrationScores;
  /** Percent of items answered. */
  completeness: number;
  /** Quality flags — the UI must surface these rather than hide them. */
  flags: {
    /** Failed the attention check. */
    inattentive: boolean;
    /** Same answer for nearly everything — scores are not interpretable. */
    straightLined: boolean;
    /** Too few answers to score. */
    incomplete: boolean;
  };
  /** False when flags make the result untrustworthy. */
  valid: boolean;
}

/** Reverse a Likert response: 1↔5, 2↔4, 3↔3. */
export function reverseScore(value: number): number {
  return LIKERT_MIN + LIKERT_MAX - value;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Scores one facet: reverse-keyed items are flipped before averaging. */
function scoreFacet(facet: Item["facet"], responses: Responses): number {
  const scored = items
    .filter((i) => i.facet === facet)
    .map((i) => {
      const raw = responses[i.id];
      if (typeof raw !== "number") return null;
      return i.reverse ? reverseScore(raw) : raw;
    })
    .filter((v): v is number => v !== null);

  return Number(mean(scored).toFixed(2));
}

/**
 * Detects straight-lining: answering (almost) everything identically.
 * With ≥90% of responses on a single value the profile carries no signal,
 * so we mark it invalid rather than deriving a policy from noise.
 */
export function isStraightLined(responses: Responses): boolean {
  const values = Object.values(responses);
  if (values.length < 10) return false;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return top / values.length >= 0.9;
}

export function scoreAssessment(responses: Responses): AssessmentResult {
  const answered = items.filter((i) => typeof responses[i.id] === "number").length;
  const completeness = Math.round((answered / items.length) * 100);

  const domains: DomainScores = {
    O: scoreFacet("O", responses),
    C: scoreFacet("C", responses),
    E: scoreFacet("E", responses),
    A: scoreFacet("A", responses),
    N: scoreFacet("N", responses),
  };

  const calibration: CalibrationScores = {
    autonomy: scoreFacet("autonomy", responses),
    risk: scoreFacet("risk", responses),
    comms: scoreFacet("comms", responses),
  };

  const checkAnswer = responses[ATTENTION_CHECK.id];
  const flags = {
    inattentive:
      typeof checkAnswer === "number" && checkAnswer !== ATTENTION_CHECK_EXPECTED,
    straightLined: isStraightLined(responses),
    incomplete: completeness < 90,
  };

  return {
    domains,
    calibration,
    completeness,
    flags,
    valid: !flags.inattentive && !flags.straightLined && !flags.incomplete,
  };
}

/** Human-readable band for a 1–5 score. */
export function band(score: number): "low" | "moderate" | "high" {
  if (score < 2.6) return "low";
  if (score <= 3.6) return "moderate";
  return "high";
}

export type { Domain };
