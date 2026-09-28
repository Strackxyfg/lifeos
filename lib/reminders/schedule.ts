import { addDays, dayNumber, daysInMonth, wallTime, weekday, zonedInstant, type Wall } from "./zoned";

/**
 * When a reminder is due, and when it comes back.
 *
 * A repeating reminder keeps its first date as an anchor, and every
 * occurrence is counted from it on the wall clock of its zone: "the 31st of
 * each month" is the 30th in April and the 31st again in May (a date moved
 * month by month from the 30th would stay on the 30th forever), and "every
 * day at 9" stays at 9 when the clocks change.
 */

export const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type Repeat = (typeof REPEATS)[number];

export function isRepeat(v: unknown): v is Repeat {
  return typeof v === "string" && (REPEATS as readonly string[]).includes(v);
}

/** The `k`-th occurrence of a series (k = 0 is the anchor itself). */
function nth(anchor: Wall, repeat: Exclude<Repeat, "none">, k: number): Wall {
  switch (repeat) {
    case "daily":
      return addDays(anchor, k);
    case "weekly":
      return addDays(anchor, 7 * k);
    case "monthly": {
      const months = anchor.y * 12 + (anchor.mo - 1) + k;
      const y = Math.floor(months / 12);
      const mo = (months % 12) + 1;
      return { ...anchor, y, mo, d: Math.min(anchor.d, daysInMonth(y, mo)) };
    }
    case "weekdays": {
      // Working days only: count k of them forward from the anchor (itself
      // counted first when it is one).
      let w = anchor;
      while (weekday(w) === 0 || weekday(w) === 6) w = addDays(w, 1);
      let left = k;
      while (left > 0) {
        w = addDays(w, 1);
        if (weekday(w) !== 0 && weekday(w) !== 6) left--;
      }
      return w;
    }
  }
}

/**
 * The first occurrence strictly after `after`, or null for a one-off already
 * past. Missed occurrences are skipped, not queued: a daily reminder left for
 * a week comes back once, not seven times.
 */
export function occurrenceAfter(anchor: Date, repeat: Repeat, after: Date, zone: string): Date | null {
  if (repeat === "none") return anchor > after ? anchor : null;
  const a = wallTime(anchor, zone);
  const base: Wall = { y: a.y, mo: a.mo, d: a.d, h: a.h, mi: a.mi };
  // (An anchor set on a weekend starts a working-days series on the next
  // working day: `nth` steps over it.) Jump near `after` first, then step: a series anchored years ago still
  // answers in a handful of steps.
  const days = Math.max(0, dayNumber(wallTime(after, zone)) - dayNumber(base));
  const estimate =
    repeat === "daily" ? days : repeat === "weekly" ? Math.floor(days / 7) : repeat === "monthly" ? Math.floor(days / 31) : Math.floor((days * 5) / 7);
  let k = Math.max(0, estimate - 2);
  for (let guard = 0; guard < 400; guard++, k++) {
    const t = zonedInstant(nth(base, repeat, k), zone);
    if (t > after) return t;
  }
  return null;
}

export interface ReminderLike {
  dueAt: string;
  anchorAt: string;
  repeat: Repeat;
  zone: string;
  done: boolean;
}

/**
 * What ticking a reminder off does: a one-off is done; a repeating one moves
 * to its next occurrence after now (and is told again when that comes).
 */
export function completion(r: ReminderLike, now: Date): { done: true; doneAt: string } | { dueAt: string; notifiedAt: null; doneAt: string } {
  if (r.repeat === "none") return { done: true, doneAt: now.toISOString() };
  const next = occurrenceAfter(new Date(r.anchorAt), r.repeat, new Date(Math.max(now.getTime(), Date.parse(r.dueAt))), r.zone);
  // A series cannot run out; should it ever, it is done rather than stuck.
  if (!next) return { done: true, doneAt: now.toISOString() };
  return { dueAt: next.toISOString(), notifiedAt: null, doneAt: now.toISOString() };
}

export type SnoozeChoice = "10m" | "1h" | "tomorrow" | "nextWeek";

/** When a snoozed reminder comes back. Tomorrow and next week are at 9 on the person's clock. */
export function snoozeUntil(choice: SnoozeChoice, now: Date, zone: string): Date {
  if (choice === "10m") return new Date(now.getTime() + 10 * 60_000);
  if (choice === "1h") return new Date(now.getTime() + 60 * 60_000);
  const w = wallTime(now, zone);
  const today: Wall = { y: w.y, mo: w.mo, d: w.d, h: 9, mi: 0 };
  if (choice === "tomorrow") return zonedInstant(addDays(today, 1), zone);
  // Next Monday (a week from today when today is Monday).
  const toMonday = ((8 - weekday(today)) % 7) || 7;
  return zonedInstant(addDays(today, toMonday), zone);
}

export type Bucket = "overdue" | "today" | "tomorrow" | "week" | "later";

/** Where a reminder is listed, on the person's calendar. */
export function bucketOf(dueAt: Date, now: Date, zone: string): Bucket {
  if (dueAt <= now) return "overdue";
  const diff = dayNumber(wallTime(dueAt, zone)) - dayNumber(wallTime(now, zone));
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff < 7) return "week";
  return "later";
}
