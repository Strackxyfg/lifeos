import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * A scheduled job's call: `Authorization: Bearer <CRON_SECRET>` — the header
 * Vercel's cron sends, and what an external scheduler (or the agent's VPS)
 * is configured to send. Refused when the secret is unset: a job endpoint
 * that anyone can trigger is an endpoint anyone can make spam.
 */
export function verifyCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Hashed first: the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
