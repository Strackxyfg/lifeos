import { hash } from "@/lib/brain/text";
import { ageInDays } from "@/lib/brain/focus";
import { neighborsOf, openTensions, type LinkLike, type NoteLike } from "@/lib/brain/graph";
import { DIMENSIONS, type Dimension } from "./portrait";

/**
 * The question of the day: how the double gets to know the person.
 *
 * One question a day, answered in a sentence or by voice; the answer becomes
 * a note, and the double reads it at once (`portrait.ts`) — so each answer
 * visibly teaches it something. Which question:
 *
 *  - first, a follow-up on what the brain shows they are living through: a
 *    goal with no next step for a week ("What holds you back on …?"), a
 *    tension still open ("Between … and …, what matters most right now?");
 *  - then the bank, asked where the double knows the least (`coverage`), so
 *    the portrait fills out evenly instead of piling up in one dimension;
 *  - never the same question twice, and the same order all day — a reload
 *    does not change the question, a "another one" moves to the next.
 *
 * The questions' words live in the dictionaries (`self.questions`), in both
 * languages; here they are only ids.
 */

/** Questions per dimension in the bank. */
export const BANK_SIZE = 6;

export const BANK: readonly { id: string; dimension: Dimension }[] = DIMENSIONS.flatMap((dimension) =>
  Array.from({ length: BANK_SIZE }, (_, i) => ({ id: `${dimension}-${i + 1}`, dimension }))
);

export type Question =
  | { id: string; kind: "bank"; dimension: Dimension }
  /** A goal with no way forward for a while. */
  | { id: string; kind: "goal"; dimension: "obstacles"; noteId: string; title: string }
  /** Two notes pulling against each other. */
  | { id: string; kind: "tension"; dimension: "values"; linkId: string; a: { id: string; title: string }; b: { id: string; title: string } };

/** A goal waits this long without a next step before the double asks about it. */
export const GOAL_QUIET_DAYS = 7;

/** Follow-ups on the brain as it is, most pressing first. Their ids name what they are about. */
export function followUps(input: { notes: NoteLike[]; links: (LinkLike & { id?: string })[]; now: Date; answered: Set<string> }): Question[] {
  const { notes, links, now, answered } = input;
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out: Question[] = [];

  const serving = links.filter((l) => (l.kind ?? "related") !== "tension");
  const goals = notes
    .filter((n) => n.category === "goals" && !n.done && ageInDays(n.createdAt, now) >= GOAL_QUIET_DAYS)
    .filter((g) => ![...neighborsOf(g.id, serving)].some((id) => byId.get(id)?.category === "next" && !byId.get(id)?.done))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const g of goals) {
    const id = `goal:${g.id}`;
    if (!answered.has(id)) out.push({ id, kind: "goal", dimension: "obstacles", noteId: g.id, title: g.title });
  }

  for (const l of openTensions(links)) {
    if (!l.id) continue;
    const a = byId.get(l.fromId);
    const b = byId.get(l.toId);
    const id = `tension:${l.id}`;
    if (!a || !b || a.done || b.done || answered.has(id)) continue;
    out.push({ id, kind: "tension", dimension: "values", linkId: l.id, a: { id: a.id, title: a.title }, b: { id: b.id, title: b.title } });
  }
  return out;
}

/**
 * Today's questions, in the order to ask them: one follow-up if there is
 * one, then the bank, one question per dimension in turn, the least known
 * dimension first. Deterministic for a given person (`seed`) and day.
 */
export function questionsFor(input: {
  day: string;
  seed: string;
  coverage: Record<Dimension, number>;
  answered: Set<string>;
  followUps?: Question[];
  limit?: number;
}): Question[] {
  const { day, seed, coverage, answered, followUps: follow = [], limit = 6 } = input;
  const out: Question[] = [];
  const first = follow.find((q) => !answered.has(q.id));
  if (first) out.push(first);

  const order = [...DIMENSIONS].sort(
    (a, b) => coverage[a] - coverage[b] || hash(`${seed}:${day}:${a}`) - hash(`${seed}:${day}:${b}`)
  );
  const queues = new Map(
    order.map((d) => [
      d,
      BANK.filter((q) => q.dimension === d && !answered.has(q.id)).sort(
        (a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`)
      ),
    ])
  );
  // One per dimension in turn, so "another question" moves to another side of them.
  while (out.length < limit) {
    let added = false;
    for (const d of order) {
      const q = queues.get(d)?.shift();
      if (!q) continue;
      out.push({ id: q.id, kind: "bank", dimension: q.dimension });
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return out;
}

/** A question id as stored with a check-in: one of the bank's, or a follow-up's. */
export function isQuestionId(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 120) return false;
  return BANK.some((q) => q.id === v) || /^(goal|tension):[0-9a-z_-]{1,64}$/i.test(v);
}
