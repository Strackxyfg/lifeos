import type { LinkLike, NoteLike } from "./graph";
import type { BrainCategoryId } from "@/lib/data/brain";

/**
 * Spaced review: every note worth remembering comes back — three days after
 * it was written, then a week later, then further apart each time the person
 * says it still holds, up to six months. What they answer decides the rhythm:
 * a note that needs rework comes back in two days; one that no longer holds
 * is archived and stops coming back.
 *
 * The daily resurfaced note (`resurface.ts`) shows one note by chance; this
 * shows the notes that are due, and remembers the answer (migration 009).
 * Without the migration the brain falls back to the resurfaced note.
 *
 * Days are UTC calendar days ("YYYY-MM-DD"), like the resurfaced note, so
 * the queue does not change in the middle of a day.
 */

/** What is reviewed: material worth remembering. Next steps get done, and goals live in the focus list. */
export const REVIEWED_REGIONS: readonly BrainCategoryId[] = ["ideas", "thoughts", "knowledge", "insights"];

export const FIRST_REVIEW_DAYS = 3;
/** The interval after the first "still holds". */
export const SECOND_INTERVAL = 7;
export const GROWTH = 2.5;
export const MAX_INTERVAL = 180;
export const REWORK_DAYS = 2;
/** A review a day that takes two minutes, not a backlog that takes an hour. */
export const DAILY_REVIEWS = 5;

export type ReviewAnswer = "keep" | "rework" | "archive";

export interface ReviewFields {
  /** The day the note is next due, or null/absent when it was never reviewed. */
  reviewDue?: string | null;
  /** Days between the last review and the next. */
  reviewInterval?: number | null;
  reviewedAt?: string | null;
}

export type Reviewable = NoteLike & ReviewFields;

const DAY_MS = 86_400_000;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** When a note is due: its scheduled day or, never reviewed, three days after it was written. */
export function dueDay(n: Reviewable): string {
  return n.reviewDue ?? addDays(n.createdAt.slice(0, 10), FIRST_REVIEW_DAYS);
}

export interface ReviewItem {
  id: string;
  due: string;
  /** Days past due; 0 when due today. */
  overdue: number;
  /** Never reviewed before. */
  first: boolean;
}

export interface ReviewQueue {
  /** Today's reviews, at most `limit`. */
  items: ReviewItem[];
  /** Everything due by today, of which `items` is the head. */
  due: number;
}

/**
 * The notes due today. A review the person already scheduled comes before
 * the backlog of notes never reviewed: the first is a promise, the second a
 * catch-up. Within each, the longest overdue first. Deterministic.
 */
export function reviewQueue(input: { notes: Reviewable[]; links?: LinkLike[]; today: string; limit?: number }): ReviewQueue {
  const { notes, today, limit = DAILY_REVIEWS } = input;
  const all = notes
    .filter((n) => REVIEWED_REGIONS.includes(n.category) && !n.done && n.title.trim().length > 0)
    .map((n): ReviewItem => {
      const due = dueDay(n);
      return { id: n.id, due, overdue: daysBetween(due, today), first: !n.reviewedAt };
    })
    .filter((r) => r.overdue >= 0)
    .sort((a, b) => Number(a.first) - Number(b.first) || b.overdue - a.overdue || a.id.localeCompare(b.id));
  return { items: all.slice(0, limit), due: all.length };
}

export interface Scheduled {
  reviewDue: string | null;
  reviewInterval: number | null;
  reviewedAt: string;
  /** Archiving a note marks it done: it sinks in lists and stops coming back. */
  done?: true;
}

/** What an answer does to a note's schedule. */
export function schedule(n: Reviewable, answer: ReviewAnswer, today: string, nowIso: string): Scheduled {
  if (answer === "archive") return { reviewDue: null, reviewInterval: null, reviewedAt: nowIso, done: true };
  if (answer === "rework") return { reviewDue: addDays(today, REWORK_DAYS), reviewInterval: REWORK_DAYS, reviewedAt: nowIso };
  const prev = n.reviewInterval ?? null;
  const next = prev === null ? SECOND_INTERVAL : Math.min(MAX_INTERVAL, Math.max(prev + 1, Math.round(prev * GROWTH)));
  return { reviewDue: addDays(today, next), reviewInterval: next, reviewedAt: nowIso };
}
