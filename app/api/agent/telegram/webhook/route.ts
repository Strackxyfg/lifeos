import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyWebhookSecret,
  sendTelegram,
  resolveChat,
  redeemLinkCode,
  isTelegramConfigured,
} from "@/lib/agent/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram → LifeOS.
 *
 * Turns an incoming chat message into a pending row in `agent_messages`, which
 * the runner already knows how to claim and answer. Telegram is therefore just
 * another front end onto the same governed pipeline — the policy engine, the
 * audit log and the kill switch all apply identically.
 *
 * Always answers 200. Telegram retries non-2xx responses, and a retry storm on
 * a message we have deliberately refused helps nobody.
 */
export async function POST(req: Request) {
  if (!isTelegramConfigured() || !verifyWebhookSecret(req)) {
    // Deliberately terse: an attacker probing the endpoint learns nothing.
    return NextResponse.json({ ok: true });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim();

  if (!chatId || !text) return NextResponse.json({ ok: true });
  const chat = String(chatId);

  // ── Pairing ────────────────────────────────────────────────────────
  // `/start ABC123` is how a chat is claimed. Handled before the ownership
  // lookup, because by definition the chat isn't linked yet.
  const start = text.match(/^\/start(?:\s+(\S+))?$/i);
  if (start) {
    const code = start[1];
    if (!code) {
      await sendTelegram(
        chat,
        "👋 LifeOS agent.\n\nOpen LifeOS → Agent → Telegram, generate your pairing code, " +
          "then send it here as:\n/start YOURCODE"
      );
      return NextResponse.json({ ok: true });
    }

    const outcome = await redeemLinkCode(code, chat);
    await sendTelegram(
      chat,
      outcome.ok
        ? "✅ Linked. This chat now talks to your LifeOS agent.\n\n" +
            "Ask it anything, or give it work. Everything still passes your policy " +
            "engine — high-risk actions will come back for approval."
        : outcome.reason === "expired"
          ? "⏰ That code has expired. Generate a new one in LifeOS → Agent."
          : outcome.reason === "taken"
            ? "⚠️ That code has already been used. Generate a new one in LifeOS → Agent."
            : "❌ Unknown code. Check LifeOS → Agent → Telegram."
    );
    return NextResponse.json({ ok: true });
  }

  // ── Ownership ──────────────────────────────────────────────────────
  const userKey = await resolveChat(chat);
  if (!userKey) {
    await sendTelegram(
      chat,
      "This chat isn't linked to a LifeOS account. Open LifeOS → Agent → Telegram " +
        "for a pairing code, then send /start YOURCODE."
    );
    return NextResponse.json({ ok: true });
  }

  // ── Queue it for the runner ────────────────────────────────────────
  const db = createAdminClient();
  const { error } = await db.from("agent_messages").insert({
    user_key: userKey,
    role: "user",
    content: text.slice(0, 4000),
    status: "pending",
    channel: "telegram",
    channel_chat_id: chat,
  });

  if (error) {
    console.error("[telegram] enqueue failed", error.message);
    await sendTelegram(chat, "I couldn't queue that message. Please try again.");
  }

  return NextResponse.json({ ok: true });
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
}
