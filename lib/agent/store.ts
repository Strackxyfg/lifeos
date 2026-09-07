import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserKey, isSupabaseConfigured } from "@/lib/db/store";
import { derivePolicy, MINIMUM_POLICY, type AgentPolicy } from "./policy";
import type { AssessmentResult } from "@/lib/assessment/scoring";

export interface AgentTask {
  id: string;
  title: string;
  instruction: string;
  capabilities: string[];
  status: string;
  createdAt: string;
}

export interface PendingApproval {
  id: string;
  capability: string;
  reason: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  status: string;
  createdAt: string;
}

export interface AgentState {
  policy: AgentPolicy;
  /** What the assessment suggested, so the UI can flag a divergence. */
  recommended: string | null;
  messages: AgentMessage[];
  killSwitch: boolean;
  runsToday: number;
  spentTodayCents: number;
  assessment: AssessmentResult | null;
  assessedAt: string | null;
  tasks: AgentTask[];
  approvals: PendingApproval[];
  hasToken: boolean;
  /** False when Supabase isn't configured — the UI explains instead of erroring. */
  available: boolean;
}

const EMPTY: AgentState = {
  policy: MINIMUM_POLICY,
  recommended: null,
  messages: [],
  killSwitch: false,
  runsToday: 0,
  spentTodayCents: 0,
  assessment: null,
  assessedAt: null,
  tasks: [],
  approvals: [],
  hasToken: false,
  available: false,
};

/** Everything the agent console needs, in one cached pass. */
export const loadAgentState = cache(async function loadAgentState(): Promise<AgentState> {
  if (!isSupabaseConfigured()) return EMPTY;

  const userKey = await getUserKey();
  const db = createAdminClient();

  const [assessmentRes, policyRes, tasksRes, approvalsRes, tokenRes, messagesRes] = await Promise.all([
    db.from("agent_assessments").select("*").eq("user_key", userKey)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("agent_policies").select("*").eq("user_key", userKey).maybeSingle(),
    db.from("agent_tasks").select("*").eq("user_key", userKey)
      .order("created_at", { ascending: false }).limit(20),
    db.from("agent_audit").select("*").eq("user_key", userKey)
      .eq("decision", "approve").is("approved_at", null)
      .order("created_at", { ascending: false }).limit(20),
    db.from("agent_tokens").select("id").eq("user_key", userKey)
      .is("revoked_at", null).limit(1).maybeSingle(),
    db.from("agent_messages").select("id, role, content, status, created_at")
      .eq("user_key", userKey).order("created_at", { ascending: false }).limit(50),
  ]);

  const a = assessmentRes.data;
  const assessment: AssessmentResult | null = a
    ? {
        domains: a.domains,
        calibration: a.calibration,
        completeness: a.completeness,
        flags: a.flags,
        valid: a.valid,
      }
    : null;

  const p = policyRes.data;
  const today = new Date().toISOString().slice(0, 10);
  const stale = p ? p.usage_date !== today : true;

  return {
    policy: p
      ? {
          autonomy: p.autonomy,
          dailyBudgetCents: p.daily_budget_cents,
          dailyRunLimit: p.daily_run_limit,
          verbosity: p.verbosity,
          cadence: p.cadence,
          degraded: p.degraded,
          reasons: [],
        }
      : derivePolicy(assessment),
    recommended: p?.autonomy_recommended ?? derivePolicy(assessment).autonomy,
    messages: (messagesRes.data ?? [])
      .map((r) => ({
        id: r.id, role: r.role, content: r.content,
        status: r.status, createdAt: r.created_at,
      }))
      .reverse(),
    killSwitch: p?.kill_switch ?? false,
    runsToday: stale ? 0 : (p?.runs_today ?? 0),
    spentTodayCents: stale ? 0 : (p?.spent_today_cents ?? 0),
    assessment,
    assessedAt: a?.created_at ?? null,
    tasks: (tasksRes.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      instruction: t.instruction,
      capabilities: t.capabilities ?? [],
      status: t.status,
      createdAt: t.created_at,
    })),
    approvals: (approvalsRes.data ?? []).map((r) => ({
      id: r.id,
      capability: r.capability,
      reason: r.reason,
      payload: r.payload,
      createdAt: r.created_at,
    })),
    hasToken: Boolean(tokenRes.data),
    available: true,
  };
});
