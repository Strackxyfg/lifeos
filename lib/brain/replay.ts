import type { LinkLike, NoteLike } from "./graph";

/**
 * The brain's history, as a sequence to replay: each note when it was
 * written, each connection when it was drawn.
 *
 * Replayed in order, not in real time. People write in bursts — onboarding
 * adds a dozen notes in a minute, then nothing for a day — and a real-time
 * replay would be long silences and sudden floods. One event per beat tells
 * the story instead: this thought, then that one, then the link between them.
 *
 * A connection never appears before both its notes: one drawn by the engine
 * is dated when it was drawn; one whose date is unknown (older data), when
 * its second note appeared.
 */

export interface ReplayEvent {
  kind: "note" | "link";
  id: string;
  at: string;
}

type DatedLink = LinkLike & { id: string; createdAt?: string };

export function replayEvents(notes: NoteLike[], links: DatedLink[]): ReplayEvent[] {
  const born = new Map(notes.map((n) => [n.id, n.createdAt]));
  const events: ReplayEvent[] = notes.map((n) => ({ kind: "note", id: n.id, at: n.createdAt }));
  for (const l of links) {
    const a = born.get(l.fromId);
    const b = born.get(l.toId);
    if (!a || !b) continue;
    const ends = a > b ? a : b;
    const at = l.createdAt && l.createdAt > ends ? l.createdAt : ends;
    events.push({ kind: "link", id: l.id, at });
  }
  // Same instant: notes before connections, so both ends are already there.
  return events.sort(
    (x, y) => x.at.localeCompare(y.at) || (x.kind === y.kind ? 0 : x.kind === "note" ? -1 : 1) || x.id.localeCompare(y.id)
  );
}

/** What is visible once the first `count` events have played. */
export function visibleAt(events: ReplayEvent[], count: number): { notes: Set<string>; links: Set<string>; at: string | null } {
  const notes = new Set<string>();
  const links = new Set<string>();
  const n = Math.max(0, Math.min(count, events.length));
  for (let i = 0; i < n; i++) (events[i].kind === "note" ? notes : links).add(events[i].id);
  return { notes, links, at: n > 0 ? events[n - 1].at : null };
}

/** Milliseconds per event: a whole brain in about ten seconds, never a blur, never a crawl. */
export function beatFor(eventCount: number): number {
  if (eventCount <= 0) return 0;
  return Math.min(400, Math.max(35, Math.round(10_000 / eventCount)));
}
