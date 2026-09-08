import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Telegram as a front door to the agent.
 *
 * Two independent checks stand between a Telegram message and someone's
 * second brain, and both must pass:
 *   1. The request really came from Telegram — verified with the secret token
 *      header that Telegram echoes back on every webhook call.
 *   2. The chat has been claimed by an owner with a one-time pairing code.
 *      An unknown chat gets instructions and nothing else; it is never able to
 *      read or write anything.
 */

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

const API = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

/**
 * Constant-time comparison of the webhook secret.
 *
 * Telegram sends this header on every update; a mismatch means the request did
 * not come from Telegram, whatever the payload claims about itself.
 */
export function verifyWebhookSecret(req: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  // Refuse rather than run unauthenticated: an unset secret would let anyone
  // who guesses the URL inject messages.
  if (!expected) return false;

  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  // Hash both sides so the compare is length-independent and still constant time.
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  try {
    const res = await fetch(API("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        // Telegram hard-caps a message at 4096 characters.
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[telegram] sendMessage HTTP ${res.status}`, await res.text().catch(() => ""));
    }
    return res.ok;
  } catch (err) {
    console.error("[telegram] send failed", err);
    return false;
  }
}

/** Resolves a Telegram chat to its owner, or null if the chat isn't linked. */
export async function resolveChat(chatId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("agent_channels")
    .select("user_key, verified_at")
    .eq("provider", "telegram")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (!data?.verified_at) return null;
  return data.user_key;
}

/**
 * Issues a pairing code for the owner to send to the bot.
 *
 * Short and short-lived: it is typed by hand into a chat, and it grants
 * ongoing access to the agent, so it expires in 15 minutes.
 */
export async function createLinkCode(userKey: string): Promise<{ code: string; expiresAt: string }> {
  const code = randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  const db = createAdminClient();
  // One live link per user per provider — re-issuing replaces the old code and
  // unlinks any previously paired chat, which is also how you revoke access.
  const { error } = await db
    .from("agent_channels")
    .upsert(
      {
        user_key: userKey,
        provider: "telegram",
        link_code: code,
        link_expires: expiresAt,
        chat_id: null,
        verified_at: null,
      },
      { onConflict: "user_key,provider" }
    );
  if (error) throw new Error(error.message);

  return { code, expiresAt };
}

export type LinkOutcome =
  | { ok: true; userKey: string }
  | { ok: false; reason: "unknown" | "expired" | "taken" };

/** Redeems a pairing code, binding this chat to the owner who issued it. */
export async function redeemLinkCode(code: string, chatId: string): Promise<LinkOutcome> {
  const db = createAdminClient();
  const { data } = await db
    .from("agent_channels")
    .select("id, user_key, link_expires, chat_id")
    .eq("provider", "telegram")
    .eq("link_code", code.trim().toUpperCase())
    .maybeSingle();

  if (!data) return { ok: false, reason: "unknown" };
  if (data.chat_id) return { ok: false, reason: "taken" };
  if (data.link_expires && new Date(data.link_expires) < new Date()) {
    return { ok: false, reason: "expired" };
  }

  const { error } = await db
    .from("agent_channels")
    .update({
      chat_id: chatId,
      verified_at: new Date().toISOString(),
      // Burn the code so it cannot pair a second chat.
      link_code: null,
      link_expires: null,
    })
    .eq("id", data.id);
  if (error) return { ok: false, reason: "unknown" };

  return { ok: true, userKey: data.user_key };
}

export async function getLinkedChat(userKey: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("agent_channels")
    .select("chat_id, verified_at")
    .eq("provider", "telegram")
    .eq("user_key", userKey)
    .maybeSingle();
  return data?.verified_at ? (data.chat_id as string) : null;
}
