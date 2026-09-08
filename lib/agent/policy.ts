import { getCapability, type RiskTier } from "./capabilities";
import { band, type AssessmentResult } from "@/lib/assessment/scoring";

/**
 * The guardrail engine.
 *
 * Design rule that everything else follows from:
 * **the assessment can only make the agent more restrictive, never less.**
 * A personality profile must never be able to unlock sending email or moving
 * money. Ceilings are hard-coded; the profile only lowers them.
 */

export type AutonomyLevel =
  /** Proposes everything, executes nothing. */
  | "observe"
  /** Executes safe reads; everything that writes needs approval. */
  | "assist"
  /** Executes internal writes; connected tools need approval. */
  | "act"
  /** Executes connected-tool writes too. Never high-risk. */
  | "extend";

export const AUTONOMY_ORDER: AutonomyLevel[] = ["observe", "assist", "act", "extend"];

/** Highest tier each level may execute WITHOUT human approval. */
const AUTO_EXECUTE_CEILING: Record<AutonomyLevel, RiskTier> = {
  observe: "safe",
  assist: "safe",
  act: "low",
  extend: "medium",
};

export interface AgentPolicy {
  autonomy: AutonomyLevel;
  /** Hard cap on model spend per day, in cents. */
  dailyBudgetCents: number;
  /** Max agent runs per day. */
  dailyRunLimit: number;
  /** Terse vs explanatory reporting. */
  verbosity: "brief" | "detailed";
  /** Batched vs immediate notifications. */
  cadence: "digest" | "realtime";
  /** Set when the profile was untrustworthy — policy is forced to minimum. */
  degraded: boolean;
  /** Human-readable reasons, shown in the UI. */
  reasons: string[];
}

/** The most restrictive policy. Used before assessment, or when it's invalid. */
export const MINIMUM_POLICY: AgentPolicy = {
  autonomy: "observe",
  dailyBudgetCents: 0,
  dailyRunLimit: 0,
  verbosity: "detailed",
  cadence: "digest",
  degraded: true,
  reasons: ["No valid assessment on file — the agent can only observe."],
};

/**
 * Derives an agent policy from the assessment.
 *
 * Autonomy comes from the operational `autonomy` axis, then is *lowered* by
 * caution signals: low risk tolerance, or high neuroticism (which predicts
 * stress at unsupervised delegation). Nothing here can raise it past `extend`.
 */
export function derivePolicy(result: AssessmentResult | null): AgentPolicy {
  if (!result || !result.valid) return { ...MINIMUM_POLICY };

  const reasons: string[] = [];
  const autonomyBand = band(result.calibration.autonomy);
  const riskBand = band(result.calibration.risk);

  let index =
    autonomyBand === "high" ? 3 : autonomyBand === "moderate" ? 2 : 1;
  reasons.push(`Delegation comfort is ${autonomyBand}.`);

  if (riskBand === "low") {
    index -= 1;
    reasons.push("Low risk tolerance — autonomy reduced one level.");
  }

  // Conscientiousness raises the appetite for a working agent; neuroticism
  // lowers tolerance for surprises. Both only ever nudge, never override.
  if (band(result.domains.N) === "high") {
    index -= 1;
    reasons.push("High sensitivity to disruption — autonomy reduced one level.");
  }
  if (band(result.domains.C) === "high" && index < 3 && riskBand !== "low") {
    index += 1;
    reasons.push("High conscientiousness — comfortable with a level more autonomy.");
  }

  const autonomy = AUTONOMY_ORDER[Math.max(0, Math.min(index, AUTONOMY_ORDER.length - 1))];

  // Budget scales with autonomy but stays small by default — the point is that
  // a runaway loop costs cents, not a salary.
  const budgets: Record<AutonomyLevel, number> = {
    observe: 0, assist: 25, act: 50, extend: 100,
  };
  const runs: Record<AutonomyLevel, number> = {
    observe: 0, assist: 20, act: 50, extend: 100,
  };

  return {
    autonomy,
    dailyBudgetCents: budgets[autonomy],
    dailyRunLimit: runs[autonomy],
    verbosity: band(result.calibration.comms) === "high" ? "brief" : "detailed",
    cadence: band(result.calibration.comms) === "high" ? "digest" : "realtime",
    degraded: false,
    reasons,
  };
}

export type Decision =
  | { action: "allow"; reason: string }
  | { action: "approve"; reason: string }
  | { action: "deny"; reason: string };

export interface UsageState {
  runsToday: number;
  spentTodayCents: number;
  killSwitchOn: boolean;
}

/**
 * The single gate every agent action passes through.
 * Order matters: kill switch → unknown → forbidden → budget → tier ceiling.
 */
/**
 * Whether a capability draws down the daily run/budget quotas.
 *
 * Only `safe` capabilities are exempt: they read LifeOS's own database, have no
 * side effects and cost nothing. Metering them meant a runner polling every
 * 30 s spent its whole daily allowance just fetching context — 50 "runs" that
 * did nothing — and then locked itself out of doing real work.
 */
export function isMetered(tier: RiskTier): boolean {
  return tier !== "safe";
}

export function decide(
  capabilityId: string,
  policy: AgentPolicy,
  usage: UsageState
): Decision {
  // The kill switch outranks everything, reads included.
  if (usage.killSwitchOn) {
    return { action: "deny", reason: "Kill switch is on — the agent is fully stopped." };
  }

  const cap = getCapability(capabilityId);
  if (!cap) {
    // Default-deny: an unlisted capability is an unreviewed one.
    return { action: "deny", reason: `Unknown capability "${capabilityId}".` };
  }

  if (cap.tier === "forbidden") {
    return { action: "deny", reason: `${cap.label} is never delegated to an agent. ${cap.rationale}` };
  }

  // Quotas bound *actions*, not observations. A read has no side effect and
  // costs nothing, so metering it would let a polling runner exhaust its own
  // budget doing nothing — which is exactly what happened in practice.
  if (!isMetered(cap.tier)) {
    return { action: "allow", reason: `${cap.label} — read-only, no side effects.` };
  }

  if (usage.runsToday >= policy.dailyRunLimit) {
    return { action: "deny", reason: `Daily run limit reached (${policy.dailyRunLimit}).` };
  }

  if (usage.spentTodayCents >= policy.dailyBudgetCents) {
    return { action: "deny", reason: "Daily budget exhausted." };
  }

  // High-risk always needs a human, at every autonomy level, by design.
  if (cap.tier === "high") {
    return { action: "approve", reason: `${cap.label} leaves your control, so it always needs your approval.` };
  }

  const ceiling = AUTO_EXECUTE_CEILING[policy.autonomy];
  const tierRankOf = (t: RiskTier) => ["safe", "low", "medium", "high", "forbidden"].indexOf(t);

  if (tierRankOf(cap.tier) <= tierRankOf(ceiling)) {
    return { action: "allow", reason: `Within your "${policy.autonomy}" autonomy level.` };
  }

  return {
    action: "approve",
    reason: `${cap.label} is above your "${policy.autonomy}" autonomy level — approve it once and it runs.`,
  };
}
