import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRunner } from "@/lib/agent/token";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The runner's inbox: user messages waiting for a reply.
 *
 * GET claims the oldest pending messages (marking them `claimed`) so two
 * runners can't answer the same message twice. A claim older than 5 minutes is
 * considered abandoned and becomes claimable again, so a crashed runner doesn't
 * strand a conversation.
 */
export async function GET(req: Request) {
  const auth = await authenticateRunner(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createAdminClient();
  const staleCutoff = new Date(Date.now() - 5 * 60_000).toISOString();

  // Release abandoned claims first.
  await db
    .from("agent_messages")
    .update({ status: "pending" })
    .eq("user_key", auth.userKey)
    .eq("status", "claimed")
    .lt("created_at", staleCutoff);

  const { data: pending } = await db
    .from("agent_messages")
    .select("id, content, created_at")
    .eq("user_key", auth.userKey)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);

  if (!pending?.length) return NextResponse.json({ messages: [], history: [] });

  await db
    .from("agent_messages")
    .update({ status: "claimed" })
    .in("id", pending.map((m) => m.id));

  // Recent turns, so the agent answers with context rather than in a vacuum.
  const { data: history } = await db
    .from("agent_messages")
    .select("role, content")
    .eq("user_key", auth.userKey)
    .eq("status", "handled")
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    messages: pending,
    history: (history ?? []).reverse(),
  });
}

const replySchema = z.object({
  replyTo: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
  runId: z.string().uuid().optional(),
  failed: z.boolean().optional(),
});

/** The runner posts its answer and closes out the source message. */
export async function POST(req: Request) {
  const auth = await authenticateRunner(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = replySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = createAdminClient();

  // Only close a message this user owns and this runner actually claimed.
  const { data: source } = await db
    .from("agent_messages")
    .select("id")
    .eq("id", parsed.data.replyTo)
    .eq("user_key", auth.userKey)
    .eq("status", "claimed")
    .maybeSingle();

  if (!source) return NextResponse.json({ error: "not_claimed" }, { status: 409 });

  const { error } = await db.from("agent_messages").insert({
    user_key: auth.userKey,
    role: "agent",
    content: parsed.data.content,
    status: "handled",
    run_id: parsed.data.runId ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db
    .from("agent_messages")
    .update({ status: parsed.data.failed ? "failed" : "handled" })
    .eq("id", source.id);

  return NextResponse.json({ ok: true });
}
