/**
 * Sending due reminders where the person is when LifeOS is closed: their
 * Telegram chat with the agent, when they linked one.
 *
 * Claim, then send: an occurrence is marked as told *before* the message
 * goes, by a conditional update only one run can win — so two dispatches
 * racing (a retry, two cron hits) never send it twice. A failed send gives
 * the claim back, and the next run tries again. Pure orchestration over
 * injected effects, so it is tested without a database or a bot.
 */

export interface DueReminder {
  id: string;
  userKey: string;
  title: string;
  dueAt: string;
  repeat: string;
}

export interface DispatchDeps {
  /** Open, untold reminders due by now, oldest first (bounded by the caller). */
  due: () => Promise<DueReminder[]>;
  /** Marks one as told if nobody has; true when this run won it. */
  claim: (id: string) => Promise<boolean>;
  /** Gives a claim back after a failed send. */
  release: (id: string) => Promise<void>;
  /** The person's linked chat, or null. */
  chatOf: (userKey: string) => Promise<string | null>;
  send: (chat: string, text: string) => Promise<boolean>;
}

export interface DispatchReport {
  checked: number;
  sent: number;
  failed: number;
  /** Due, but the person has no linked chat: the app will tell them. */
  noChannel: number;
}

/** The message: short, and the person's own words. */
export function reminderMessage(r: Pick<DueReminder, "title" | "repeat">): string {
  const title = r.title.trim().slice(0, 300);
  return r.repeat && r.repeat !== "none" ? `⏰ ${title}  🔁` : `⏰ ${title}`;
}

export async function dispatchDue(deps: DispatchDeps): Promise<DispatchReport> {
  const report: DispatchReport = { checked: 0, sent: 0, failed: 0, noChannel: 0 };
  const chats = new Map<string, string | null>();
  for (const r of await deps.due()) {
    report.checked++;
    if (!chats.has(r.userKey)) chats.set(r.userKey, await deps.chatOf(r.userKey).catch(() => null));
    const chat = chats.get(r.userKey);
    if (!chat) {
      report.noChannel++;
      continue;
    }
    if (!(await deps.claim(r.id).catch(() => false))) continue;
    const ok = await deps.send(chat, reminderMessage(r)).catch(() => false);
    if (ok) report.sent++;
    else {
      report.failed++;
      await deps.release(r.id).catch(() => {});
    }
  }
  return report;
}
