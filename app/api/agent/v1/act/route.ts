import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRunner } from "@/lib/agent/token";
import { runCapability } from "@/lib/agent/gate";

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
 * decision to the append-only audit log either way. The enforcement itself
 * lives in `lib/agent/gate.ts`, shared with the MCP server.
 */
export async function POST(req: Request) {
  const auth = await authenticateRunner(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { capability, runId, payload, costCents = 0 } = parsed.data;

  const outcome = await runCapability(
    auth.userKey,
    capability,
    payload ?? {},
    costCents,
    runId
  );

  // 403 only when a guardrail refused. An action that was permitted but failed
  // to execute is a 200 carrying `decision: "deny"` — the runner must be able
  // to tell "you may not" from "it broke".
  return NextResponse.json(outcome, {
    status: outcome.blockedByPolicy && outcome.decision === "deny" ? 403 : 200,
  });
}
