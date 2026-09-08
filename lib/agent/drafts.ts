import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Work the agent produced for a human to approve.
 *
 * The split that makes an autonomous agent safe to employ: drafting is cheap,
 * private and reversible, so the agent may do it all day at `low` risk.
 * Sending is irreversible and speaks in the owner's voice, so it lives at
 * `high` and always stops for approval. A draft is the handoff between them.
 */

export type DraftKind = "email" | "campaign" | "proposal";

export interface DraftInput {
  kind: DraftKind;
  target?: string | null;
  subject?: string | null;
  body: string;
  meta?: Record<string, unknown> | null;
}

export interface Draft extends DraftInput {
  id: string;
  status: "draft" | "approved" | "sent" | "rejected";
  createdAt: string;
}

export async function createDraft(userKey: string, input: DraftInput): Promise<Draft> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("agent_drafts")
    .insert({
      user_key: userKey,
      kind: input.kind,
      target: input.target ?? null,
      subject: input.subject ?? null,
      body: input.body,
      meta: input.meta ?? null,
    })
    .select("id, kind, target, subject, body, meta, status, created_at")
    .single();

  if (error) throw new Error(error.message);
  return toDraft(data);
}

export async function listDrafts(userKey: string, limit = 25): Promise<Draft[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("agent_drafts")
    .select("id, kind, target, subject, body, meta, status, created_at")
    .eq("user_key", userKey)
    .order("created_at", { ascending: false })
    .limit(limit);

  // A missing table shouldn't take the page down — migration 006 may be pending.
  if (error) return [];
  return (data ?? []).map(toDraft);
}

export async function setDraftStatus(
  userKey: string,
  id: string,
  status: Draft["status"]
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("agent_drafts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_key", userKey);
  if (error) throw new Error(error.message);
}

function toDraft(row: Record<string, unknown>): Draft {
  return {
    id: String(row.id),
    kind: row.kind as DraftKind,
    target: (row.target as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    body: String(row.body ?? ""),
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    status: row.status as Draft["status"],
    createdAt: String(row.created_at),
  };
}
