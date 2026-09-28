import type { DbReminder } from "@/lib/db/types";
import { bucketOf, type Repeat } from "./schedule";

/** Fired with the whole open list whenever the dashboard changes it. */
export const REMINDERS_EVENT = "lifeos:reminders";
/** Fired with one reminder when an alert completed or snoozed it. */
export const REMINDER_UPDATED_EVENT = "lifeos:reminder-updated";

/** A reminder as the page needs it — never the owner's key. */
export interface ClientReminder {
  id: string;
  title: string;
  dueAt: string;
  repeat: Repeat;
  zone: string;
  done: boolean;
  doneAt: string | null;
  noteId: string | null;
  notifiedAt: string | null;
}

export function toClientReminder(r: DbReminder): ClientReminder {
  return {
    id: r.id,
    title: r.title,
    dueAt: r.dueAt,
    repeat: r.repeat,
    zone: r.zone,
    done: r.done,
    doneAt: r.doneAt ?? null,
    noteId: r.noteId ?? null,
    notifiedAt: r.notifiedAt ?? null,
  };
}

/** What a page's watcher needs: open, and due within the next day and a half (or already). */
export function upcomingReminders(rows: DbReminder[], now: Date): ClientReminder[] {
  const horizon = now.getTime() + 36 * 3_600_000;
  return openReminders(rows).filter((r) => Date.parse(r.dueAt) <= horizon);
}

/** Open reminders, soonest first. */
export function openReminders(rows: DbReminder[]): ClientReminder[] {
  return rows
    .filter((r) => !r.done)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .map(toClientReminder);
}

/**
 * What the hub and the dashboard count: overdue, and still due today — "today"
 * on the clock of each reminder's own zone, which is the person's (the server
 * has no clock of theirs).
 */
export function reminderCounts(rows: Pick<DbReminder, "done" | "dueAt" | "title" | "zone">[], now: Date) {
  const open = rows.filter((r) => !r.done).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const overdue = open.filter((r) => Date.parse(r.dueAt) <= now.getTime()).length;
  const today = open.filter((r) => bucketOf(new Date(r.dueAt), now, r.zone) === "today").length;
  const next = open.find((r) => Date.parse(r.dueAt) > now.getTime()) ?? null;
  return { overdue, today, next: next ? { title: next.title, dueAt: next.dueAt } : null };
}
