"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserKey, isSupabaseConfigured } from "@/lib/db/store";
import { scoreAssessment } from "@/lib/assessment/scoring";
import { derivePolicy } from "@/lib/agent/policy";
import { LIKERT_MIN, LIKERT_MAX } from "@/lib/assessment/instrument";

export type SubmitState =
  | { ok: true; valid: boolean }
  | { ok: false; error: string };

const schema = z.record(z.number().int().min(LIKERT_MIN).max(LIKERT_MAX));

/**
 * Scores the assessment, derives the agent policy and stores both.
 *
 * Scoring happens on the server: the client could otherwise post a flattering
 * profile straight into the policy engine. An invalid profile still gets
 * stored — the audit trail matters — but yields the minimum policy.
 */
export async function submitAssessment(responses: unknown): Promise<SubmitState> {
  const parsed = schema.safeParse(responses);
  if (!parsed.success) return { ok: false, error: "Invalid responses." };

  const result = scoreAssessment(parsed.data);
  const policy = derivePolicy(result);

  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Connect Supabase to store your assessment." };
  }

  try {
    const userKey = await getUserKey();
    const db = createAdminClient();

    const { error: aErr } = await db.from("agent_assessments").insert({
      user_key: userKey,
      responses: parsed.data,
      domains: result.domains,
      calibration: result.calibration,
      completeness: result.completeness,
      valid: result.valid,
      flags: result.flags,
    });
    if (aErr) return { ok: false, error: aErr.message };

    const { error: pErr } = await db.from("agent_policies").upsert(
      {
        user_key: userKey,
        autonomy: policy.autonomy,
        daily_budget_cents: policy.dailyBudgetCents,
        daily_run_limit: policy.dailyRunLimit,
        verbosity: policy.verbosity,
        cadence: policy.cadence,
        degraded: policy.degraded,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_key" }
    );
    if (pErr) return { ok: false, error: pErr.message };

    revalidatePath("/agent");
    revalidatePath("/assessment");
    return { ok: true, valid: result.valid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}
