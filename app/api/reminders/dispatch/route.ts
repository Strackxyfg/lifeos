import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/auth/cron";
import { isSupabaseConfigured } from "@/lib/db/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedChat, isTelegramConfigured, sendTelegram } from "@/lib/agent/telegram";
import { dispatchDue, type DueReminder } from "@/lib/reminders/dispatch";

/**
 * Sends due reminders to the people who linked Telegram, while LifeOS is
 * closed. Called by a scheduler with the cron secret — every minute is right
 * (Vercel Pro's cron, an external cron service, or the agent's VPS).
 *
 * Only occurrences due in the last day are sent: when the scheduler starts
 * (or comes back after an outage) it does not unload a backlog of stale
 * reminders; those are shown in the app instead.
 */
export const dynamic = "force-dynamic";

const BATCH = 200;
const WINDOW_MS = 24 * 3_600_000;

async function run(req: Request) {
  if (!verifyCronSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ skipped: "no_database" });
  if (!isTelegramConfigured()) return NextResponse.json({ skipped: "telegram_not_configured" });

  const db = createAdminClient();
  const now = new Date();
  const report = await dispatchDue({
    due: async () => {
      const { data, error } = await db
        .from("lifeos_reminders")
        .select("id, user_key, title, due_at, repeat")
        .eq("done", false)
        .is("notified_at", null)
        .lte("due_at", now.toISOString())
        .gte("due_at", new Date(now.getTime() - WINDOW_MS).toISOString())
        .order("due_at", { ascending: true })
        .limit(BATCH);
      if (error) throw new Error(error.message);
      return (data ?? []).map(
        (r): DueReminder => ({ id: r.id, userKey: r.user_key, title: r.title, dueAt: r.due_at, repeat: r.repeat })
      );
    },
    claim: async (id) => {
      const { data, error } = await db
        .from("lifeos_reminders")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", id)
        .is("notified_at", null)
        .select("id");
      return !error && (data?.length ?? 0) === 1;
    },
    release: async (id) => {
      await db.from("lifeos_reminders").update({ notified_at: null }).eq("id", id);
    },
    chatOf: (userKey) => getLinkedChat(userKey),
    send: (chat, text) => sendTelegram(chat, text),
  });
  return NextResponse.json(report);
}

export const GET = run;
export const POST = run;
