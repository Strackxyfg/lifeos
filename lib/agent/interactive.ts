import "server-only";
import { isSupabaseConfigured } from "@/lib/db/store";
import { AUTONOMY_ORDER, decide, type AgentPolicy, type AutonomyLevel, type Decision } from "./policy";

/**
 * The policy of the agent in the app — the same engine as the runner's
 * (`policy.ts`), set for someone who is there, watching each step.
 *
 *  - Autonomy: what the owner chose for their agent (`agent_policies`), and
 *    `act` for someone who never set it — reads and writes inside LifeOS run,
 *    anything outside asks, anything high-risk always asks, the forbidden
 *    never runs. "Ask before every change" lowers it to `assist` for the
 *    request; nothing on the request can raise it.
 *  - The kill switch stops this agent too.
 *  - No daily metering here: requests are counted per edition instead
 *    (`lib/ai/quota.ts`), the person being present for each.
 *
 * Reading the policy fails closed: an error gives `assist`, not `act`.
 */

export interface InteractivePolicy {
  autonomy: AutonomyLevel;
  killSwitch: boolean;
}

const rank = (a: AutonomyLevel) => AUTONOMY_ORDER.indexOf(a);

export async function interactivePolicy(userKey: string, strict: boolean): Promise<InteractivePolicy> {
  let autonomy: AutonomyLevel = "act";
  let killSwitch = false;
  if (isSupabaseConfigured()) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { data, error } = await createAdminClient()
        .from("agent_policies")
        .select("autonomy, kill_switch")
        .eq("user_key", userKey)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) {
        autonomy = AUTONOMY_ORDER.includes(data.autonomy) ? data.autonomy : "assist";
        killSwitch = Boolean(data.kill_switch);
      }
    } catch (err) {
      console.error("[agent] policy read failed", err instanceof Error ? err.message : err);
      autonomy = "assist";
    }
  }
  if (strict && rank(autonomy) > rank("assist")) autonomy = "assist";
  return { autonomy, killSwitch };
}

export function decider(p: InteractivePolicy): (capability: string) => Decision {
  const policy: AgentPolicy = {
    autonomy: p.autonomy,
    dailyBudgetCents: Number.POSITIVE_INFINITY,
    dailyRunLimit: Number.POSITIVE_INFINITY,
    verbosity: "detailed",
    cadence: "realtime",
    degraded: false,
    reasons: [],
  };
  return (capability) => decide(capability, policy, { runsToday: 0, spentTodayCents: 0, killSwitchOn: p.killSwitch });
}
