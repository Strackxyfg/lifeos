import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decide, isMetered, type AgentPolicy } from "./policy";
import { getCapability } from "./capabilities";
import { executeCapability } from "./execute";

/**
 * The single enforcement path for every agent action.
 *
 * Both front doors — the REST `/act` endpoint used by the LifeOS runner and
 * the MCP server used by Hermes — go through here. That is deliberate: two
 * copies of this logic would drift, and the copy that drifts is the one that
 * quietly stops enforcing something.
 *
 * Load policy → decide → execute (in LifeOS, never in the caller) → audit →
 * meter. Nothing skips a step.
 */

export interface GateOutcome {
  decision: "allow" | "approve" | "deny";
  reason: string;
  executed: boolean;
  /**
   * True when the *policy* refused, false when the action was permitted but
   * execution failed. Both surface as `deny` to the caller, but they are very
   * different events: one is a guardrail working, the other is a bug or a
   * missing integration, and they must not be reported identically.
   */
  blockedByPolicy: boolean;
}

export async function runCapability(
  userKey: string,
  capability: string,
  payload: Record<string, unknown> = {},
  costCents = 0,
  runId?: string
): Promise<GateOutcome> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("agent_policies")
    .select("*")
    .eq("user_key", userKey)
    .maybeSingle();

  // No policy row means the assessment gate was never passed.
  if (!row) {
    await audit(userKey, runId, capability, "deny", "No assessment on file.", payload);
    return { decision: "deny", reason: "No assessment on file.", executed: false, blockedByPolicy: true };
  }

  // Usage counters reset daily; a stale date means today's usage is zero.
  const today = new Date().toISOString().slice(0, 10);
  const stale = row.usage_date !== today;

  const policy: AgentPolicy = {
    autonomy: row.autonomy,
    dailyBudgetCents: row.daily_budget_cents,
    dailyRunLimit: row.daily_run_limit,
    verbosity: row.verbosity,
    cadence: row.cadence,
    degraded: row.degraded,
    reasons: [],
  };

  const decision = decide(capability, policy, {
    runsToday: stale ? 0 : row.runs_today,
    spentTodayCents: stale ? 0 : row.spent_today_cents,
    killSwitchOn: row.kill_switch,
  });

  if (decision.action !== "allow") {
    await audit(userKey, runId, capability, decision.action, decision.reason, payload);
    return { decision: decision.action, reason: decision.reason, executed: false, blockedByPolicy: true };
  }

  // Allowed → LifeOS performs the effect itself. The caller never executes.
  const result = await executeCapability(userKey, capability, payload);

  await audit(
    userKey, runId, capability,
    result.ok ? "allow" : "deny",
    result.ok ? `${decision.reason} ${result.detail}` : result.error,
    payload
  );

  // Read-only capabilities don't draw down the quotas — see isMetered().
  // A `stale` counter (usage_date in the past) is rolled over either way, so
  // the day still resets on the first call of a new day.
  const metered = isMetered(getCapability(capability)?.tier ?? "high");
  if (metered || stale) {
    await db
      .from("agent_policies")
      .update({
        usage_date: today,
        runs_today: (stale ? 0 : row.runs_today) + (metered ? 1 : 0),
        spent_today_cents: (stale ? 0 : row.spent_today_cents) + (metered ? costCents : 0),
        updated_at: new Date().toISOString(),
      })
      .eq("user_key", userKey);
  }

  return {
    decision: result.ok ? "allow" : "deny",
    reason: result.ok ? result.detail : result.error,
    executed: result.ok,
    blockedByPolicy: false,
  };
}

async function audit(
  userKey: string,
  runId: string | undefined,
  capability: string,
  decision: string,
  reason: string,
  payload?: Record<string, unknown>
) {
  try {
    await createAdminClient().from("agent_audit").insert({
      user_key: userKey,
      run_id: runId ?? null,
      capability,
      decision,
      reason,
      payload: payload ?? null,
    });
  } catch (err) {
    // An audit failure must be loud but must not silently allow the action.
    console.error("[agent] audit write failed", err);
  }
}
