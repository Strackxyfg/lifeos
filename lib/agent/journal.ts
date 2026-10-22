import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { isSupabaseConfigured } from "@/lib/db/store";
import { dataDir } from "@/lib/db/data-dir";
import type { JournalEntry } from "./loop";

/**
 * The record of what the agent in the app did: every call it ran, every one
 * refused or declined, with the owner's approval when they gave it.
 *
 * With Supabase it is the same append-only `agent_audit` table the runner
 * and MCP write to (prefixed `[app]`, so the console can tell them apart);
 * without, a JSON-lines file next to the local store. A pause for approval
 * is not written: the decision is, once it is made.
 *
 * Arguments are kept, cut to a reasonable length: the audit says what was
 * done, it is not a second copy of the brain.
 */

const MAX_FIELD = 2_000;

function trimmed(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([k, v]) => [k, typeof v === "string" && v.length > MAX_FIELD ? `${v.slice(0, MAX_FIELD)}…` : v])
  );
}

export async function journal(userKey: string, entry: JournalEntry): Promise<void> {
  const at = new Date().toISOString();
  const row = {
    user_key: userKey,
    capability: entry.capability,
    decision: entry.decision,
    reason: `[app] ${entry.reason}`.slice(0, 1_000),
    payload: trimmed(entry.payload),
    ...(entry.approvedByOwner ? { approved_by: userKey, approved_at: at } : {}),
  };
  try {
    if (isSupabaseConfigured()) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { error } = await createAdminClient().from("agent_audit").insert(row);
      if (error) throw new Error(error.message);
      return;
    }
    const dir = dataDir();
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "agent-audit.jsonl"), `${JSON.stringify({ ...row, created_at: at })}\n`, "utf8");
  } catch (err) {
    // Loud, and never a reason to undo what was done or to block what is next.
    console.error("[agent] journal write failed", err instanceof Error ? err.message : err);
  }
}
