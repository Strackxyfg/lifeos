import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRunner } from "@/lib/agent/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { decide, isMetered, type AgentPolicy } from "@/lib/agent/policy";
import { getCapability } from "@/lib/agent/capabilities";
import { executeCapability } from "@/lib/agent/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  capability: z.string().min(1).max(64),
  runId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
  /** Model spend the runner is reporting for this step, in cents. */
  costCents: z.number().int().min(0).max(10_000).optional(),
});

/**
 * The gate. Every action the remote runner wants to take is proposed here
 * first — the runner has no ability to execute anything on its own.
 *
 * Returns `allow`, `approve` (queued for the human) or `deny`, and writes the
 * decision to the append-only audit log either way.
 */
export async function POST(req: Request) {
  const auth = await authenticateRunner(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { capability, runId, payload, costCents = 0 } = parsed.data;

  const db = createAdminClient();
  const { data: row } = await db
    .from("agent_policies")
    .select("*")
    .eq("user_key", auth.userKey)
    .maybeSingle();

  // No policy row means the assessment gate was never passed.
  if (!row) {
    await audit(auth.userKey, runId, capability, "deny", "No assessment on file.", payload);
    return NextResponse.json({ decision: "deny", reason: "No assessment on file." }, { status: 403 });
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
    await audit(auth.userKey, runId, capability, decision.action, decision.reason, payload);
    return NextResponse.json(
      { decision: decision.action, reason: decision.reason },
      { status: decision.action === "deny" ? 403 : 200 }
    );
  }

  // Allowed → LifeOS performs the effect itself. The runner never executes.
  const result = await executeCapability(auth.userKey, capability, payload ?? {});

  await audit(
    auth.userKey, runId, capability,
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
      .eq("user_key", auth.userKey);
  }

  return NextResponse.json({
    decision: result.ok ? "allow" : "deny",
    reason: result.ok ? result.detail : result.error,
    executed: result.ok,
  });
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
