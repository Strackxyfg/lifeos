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

  // Live control state travels with the inbox. This is what lets the runner
  // poll fast: one cheap call tells it both "is there work" and "am I allowed
  // to work", instead of a /act round-trip on every idle cycle.
  const { data: policy } = await db
    .from("agent_policies")
    .select("kill_switch, autonomy")
    .eq("user_key", auth.userKey)
    .maybeSingle();

  const control = {
    killSwitch: Boolean(policy?.kill_switch),
    autonomy: policy?.autonomy ?? "observe",
  };

  // Stopped means stopped. Messages stay `pending` and are answered once the
  // switch goes back off — nothing is lost, and nothing runs meanwhile.
  if (control.killSwitch) {
    return NextResponse.json({ messages: [], history: [], control });
  }

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

  if (!pending?.length) return NextResponse.json({ messages: [], history: [], control });

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
    control,
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
  //
  // The channel columns arrive in migration 006, and code deploys the instant
  // it is pushed while migrations are applied by hand. Between the two, asking
  // for those columns would fail the whole query and silently drop every
  // reply — so fall back to the pre-006 shape instead of breaking the chat.
  let source: { id: string; channel?: string | null; channel_chat_id?: string | null } | null = null;
  let channelsReady = true;

  const withChannel = await db
    .from("agent_messages")
    .select("id, channel, channel_chat_id")
    .eq("id", parsed.data.replyTo)
    .eq("user_key", auth.userKey)
    .eq("status", "claimed")
    .maybeSingle();

  if (withChannel.error) {
    channelsReady = false;
    const legacy = await db
      .from("agent_messages")
      .select("id")
      .eq("id", parsed.data.replyTo)
      .eq("user_key", auth.userKey)
      .eq("status", "claimed")
      .maybeSingle();
    source = legacy.data;
  } else {
    source = withChannel.data;
  }

  if (!source) return NextResponse.json({ error: "not_claimed" }, { status: 409 });

  // The reply carries the same channel as the question, so the transcript
  // stays coherent whichever surface the conversation started on.
  const { error } = await db.from("agent_messages").insert({
    user_key: auth.userKey,
    role: "agent",
    content: parsed.data.content,
    status: "handled",
    run_id: parsed.data.runId ?? null,
    ...(channelsReady
      ? { channel: source.channel ?? "web", channel_chat_id: source.channel_chat_id ?? null }
      : {}),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db
    .from("agent_messages")
    .update({ status: parsed.data.failed ? "failed" : "handled" })
    .eq("id", source.id);

  // Deliver it to wherever the user actually is. LifeOS owns this routing so
  // the runner never needs a Telegram token — it just answers questions.
  let delivered = true;
  if (source.channel === "telegram" && source.channel_chat_id) {
    const { sendTelegram } = await import("@/lib/agent/telegram");
    delivered = await sendTelegram(source.channel_chat_id, parsed.data.content);
  }

  return NextResponse.json({ ok: true, delivered });
}
