import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Credentials for the off-machine runner.
 *
 * The runner never receives Supabase keys, Notion tokens or model keys that
 * belong to the user — it gets one opaque, revocable bearer token scoped to a
 * single user, and everything it can do flows through the policy engine.
 * Only the hash is stored, so a database leak does not yield usable tokens.
 */

const PREFIX = "lifeos_agent_";

export function generateToken(): { plaintext: string; hash: string } {
  const plaintext = PREFIX + randomBytes(32).toString("base64url");
  return { plaintext, hash: hashToken(plaintext) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare so token verification can't be timed. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface AuthedRunner {
  userKey: string;
  tokenId: string;
}

/**
 * Resolves `Authorization: Bearer …` to a user, or null.
 * Revoked tokens never authenticate.
 */
export async function authenticateRunner(req: Request): Promise<AuthedRunner | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(PREFIX)) return null;

  const db = createAdminClient();
  const { data } = await db
    .from("agent_tokens")
    .select("id, user_key, token_hash, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!data || data.revoked_at) return null;
  if (!safeEqual(data.token_hash, hashToken(token))) return null;

  // Best-effort last-used stamp; never blocks the request.
  void db.from("agent_tokens").update({ last_used: new Date().toISOString() }).eq("id", data.id);

  return { userKey: data.user_key, tokenId: data.id };
}
