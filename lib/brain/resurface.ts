import { hash } from "./text";
import { degreeMap, type LinkLike, type NoteLike } from "./graph";
import { ageInDays } from "./focus";
import type { BrainCategoryId } from "@/lib/data/brain";

/**
 * One older note, brought back to the surface each day.
 *
 * The part of a second brain people underestimate: storing is easy, it is
 * *getting things back* that makes it worth having. Without this, notes go in
 * and are never seen again.
 *
 * Deterministic for a given user and day — the same note all day, a different
 * one tomorrow — without storing anything.
 */

/** Material worth remembering. Next steps are to-dos, not memories; goals live in the focus list. */
const REMEMBERABLE: BrainCategoryId[] = ["ideas", "thoughts", "knowledge", "insights"];

/** Too recent to have been forgotten. */
export const RESURFACE_MIN_AGE_DAYS = 7;

/** YYYY-MM-DD in UTC, so the pick doesn't change mid-day with the timezone. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function pickResurface<N extends NoteLike>(input: {
  notes: N[];
  links: LinkLike[];
  now: Date;
  /** Per-user salt, so two people don't see the same rotation. */
  seed: string;
}): N | null {
  const { notes, links, now, seed } = input;

  const eligible = notes
    .filter(
      (n) =>
        REMEMBERABLE.includes(n.category) &&
        !n.done &&
        n.title.trim().length > 0 &&
        ageInDays(n.createdAt, now) >= RESURFACE_MIN_AGE_DAYS
    )
    // Sort first so the pick depends on the notes, never on the order they arrived in.
    .sort((a, b) => a.id.localeCompare(b.id));

  if (eligible.length === 0) return null;

  // Orphans — notes linked to nothing — are the ones truly at risk of being
  // forgotten, so they come up twice as often.
  const degree = degreeMap(links);
  const pool: N[] = [];
  for (const n of eligible) {
    pool.push(n);
    if ((degree.get(n.id) ?? 0) === 0) pool.push(n);
  }

  return pool[hash(`${seed}:${dayKey(now)}`) % pool.length];
}
