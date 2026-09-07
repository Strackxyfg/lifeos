"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserKey, isSupabaseConfigured } from "@/lib/db/store";
import { generateToken } from "@/lib/agent/token";
import { getCapability } from "@/lib/agent/capabilities";
import { AUTONOMY_ORDER, type AutonomyLevel } from "@/lib/agent/policy";

export type AgentResult = { ok: true } | { ok: false; error: string };
const ok: AgentResult = { ok: true };
const fail = (error: string): AgentResult => ({ ok: false, error });

async function ctx() {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
  return { userKey: await getUserKey(), db: createAdminClient() };
}

/**
 * Sets the autonomy level the user wants.
 *
 * The assessment recommends; the account owner decides. This does **not**
 * weaken the guardrails: high-risk capabilities still always need approval and
 * forbidden ones stay forbidden at every level. The change is audited so the
 * history shows who widened the agent's reach and when.
 */
export async function setAutonomy(level: string): Promise<AgentResult> {
  if (!AUTONOMY_ORDER.includes(level as AutonomyLevel)) return fail("Unknown autonomy level.");
  const autonomy = level as AutonomyLevel;

  const budgets: Record<AutonomyLevel, number> = { observe: 0, assist: 25, act: 50, extend: 100 };
  const runs: Record<AutonomyLevel, number> = { observe: 0, assist: 20, act: 50, extend: 100 };

  try {
    const { userKey, db } = await ctx();
    const { error } = await db.from("agent_policies").upsert(
      {
        user_key: userKey,
        autonomy,
        daily_budget_cents: budgets[autonomy],
        daily_run_limit: runs[autonomy],
        autonomy_chosen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_key" }
    );
    if (error) return fail(error.message);

    await db.from("agent_audit").insert({
      user_key: userKey,
      capability: "policy.autonomy",
      decision: "allow",
      reason: `Autonomy set to "${autonomy}" by the account owner.`,
      approved_by: userKey,
      approved_at: new Date().toISOString(),
    });

    revalidatePath("/agent");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed.");
  }
}

/** Posts a message to the agent. The runner picks it up from its inbox. */
export async function sendAgentMessage(content: string): Promise<AgentResult> {
  const text = content.trim().slice(0, 4000);
  if (!text) return fail("Write something first.");

  try {
    const { userKey, db } = await ctx();
    const { error } = await db.from("agent_messages").insert({
      user_key: userKey,
      role: "user",
      content: text,
      status: "pending",
    });
    if (error) return fail(error.message);
    revalidatePath("/agent");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed.");
  }
}

/** Stops the agent dead. Reversible, but nothing runs while it's on. */
export async function setKillSwitch(on: boolean): Promise<AgentResult> {
  try {
    const { userKey, db } = await ctx();
    const { error } = await db.from("agent_policies").upsert(
      { user_key: userKey, kill_switch: on, updated_at: new Date().toISOString() },
      { onConflict: "user_key" }
    );
    if (error) return fail(error.message);
    revalidatePath("/agent");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed.");
  }
}

const taskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(120),
  instruction: z.string().trim().min(1, "Describe what the agent should do.").max(2000),
  capabilities: z.array(z.string().max(64)).max(12).default([]),
});

export async function createAgentTask(
  _prev: AgentResult,
  formData: FormData
): Promise<AgentResult> {
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    instruction: formData.get("instruction"),
    capabilities: formData.getAll("capabilities").map(String),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid task.");

  // Refuse forbidden capabilities at authoring time, not just at execution.
  for (const id of parsed.data.capabilities) {
    const cap = getCapability(id);
    if (!cap) return fail(`Unknown capability "${id}".`);
    if (cap.tier === "forbidden") return fail(`${cap.label} can never be delegated.`);
  }

  try {
    const { userKey, db } = await ctx();
    const { error } = await db.from("agent_tasks").insert({
      user_key: userKey,
      title: parsed.data.title,
      instruction: parsed.data.instruction,
      capabilities: parsed.data.capabilities,
    });
    if (error) return fail(error.message);
    revalidatePath("/agent");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed.");
  }
}

export async function cancelAgentTask(id: string): Promise<AgentResult> {
  try {
    const { userKey, db } = await ctx();
    const { error } = await db.from("agent_tasks")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_key", userKey);
    if (error) return fail(error.message);
    revalidatePath("/agent");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed.");
  }
}

/** Resolves a pending approval. The audit row is stamped, never rewritten. */
export async function resolveApproval(id: string, approve: boolean): Promise<AgentResult> {
  try {
    const { userKey, db } = await ctx();
    const { error } = await db.from("agent_audit")
      .update({
        decision: approve ? "allow" : "deny",
        approved_by: userKey,
        approved_at: new Date().toISOString(),
        reason: approve ? "Approved by the account owner." : "Declined by the account owner.",
      })
      .eq("id", id).eq("user_key", userKey).is("approved_at", null);
    if (error) return fail(error.message);
    revalidatePath("/agent");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed.");
  }
}

/**
 * Mints a runner token. The plaintext is returned once and never stored —
 * only its SHA-256 hash goes to the database. Any previous token is revoked so
 * there is exactly one live credential per user.
 */
export async function mintRunnerToken(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  try {
    const { userKey, db } = await ctx();
    await db.from("agent_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_key", userKey).is("revoked_at", null);

    const { plaintext, hash } = generateToken();
    const { error } = await db.from("agent_tokens").insert({
      user_key: userKey, token_hash: hash, name: "VPS runner",
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/agent");
    return { ok: true, token: plaintext };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function revokeRunnerTokens(): Promise<AgentResult> {
  try {
    const { userKey, db } = await ctx();
    const { error } = await db.from("agent_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_key", userKey).is("revoked_at", null);
    if (error) return fail(error.message);
    revalidatePath("/agent");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed.");
  }
}
