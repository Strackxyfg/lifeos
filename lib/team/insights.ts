import { buildSimilarityIndex, type LinkLike, type NoteLike } from "@/lib/brain/graph";
import { computeFocus } from "@/lib/brain/focus";

/**
 * What a team's shared notes say that no single member could see.
 *
 * Encounters: two members thinking about the same thing without knowing it
 * — the brain's own similarity engine, run across people instead of across
 * one person's notes. "For you": what teammates shared that meets one of
 * your private notes — computed for you alone, from your notes and what was
 * shared with you; nobody else ever sees it, and nothing is stored.
 *
 * Pure: the page's loader feeds it, the tests check it.
 */

export interface AuthoredNote extends NoteLike {
  author: string;
}

export interface Encounter {
  a: string;
  b: string;
  score: number;
  /** The shared words or concepts — the reason, shown as it is. */
  shared: string[];
}

/** At most this many encounters per note: one prolific note should not fill the list. */
const PER_NOTE = 2;

export function encounters(notes: AuthoredNote[], limit = 6): Encounter[] {
  if (notes.length < 2) return [];
  const index = buildSimilarityIndex(notes);
  const author = new Map(notes.map((n) => [n.id, n.author]));
  const candidates = index
    .pairs({ top: 400 })
    .filter((p) => author.get(p.a) !== author.get(p.b))
    .sort((x, y) => y.score - x.score || `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`));
  const used = new Map<string, number>();
  const out: Encounter[] = [];
  for (const p of candidates) {
    if ((used.get(p.a) ?? 0) >= PER_NOTE || (used.get(p.b) ?? 0) >= PER_NOTE) continue;
    const match = index.compare(p.a, p.b);
    if (!match) continue;
    out.push({ a: p.a, b: p.b, score: p.score, shared: match.shared.slice(0, 4) });
    used.set(p.a, (used.get(p.a) ?? 0) + 1);
    used.set(p.b, (used.get(p.b) ?? 0) + 1);
    if (out.length >= limit) break;
  }
  return out;
}

export interface ForYou {
  /** One of your own notes. */
  mine: string;
  /** A teammate's shared note that meets it. */
  theirs: string;
  score: number;
  shared: string[];
}

/**
 * Your notes against what others shared. Ids are namespaced inside the
 * index so a private note can never be mistaken for a shared one.
 */
export function forYou(mine: NoteLike[], shared: AuthoredNote[], me: string, limit = 5): ForYou[] {
  const theirs = shared.filter((n) => n.author !== me);
  if (mine.length === 0 || theirs.length === 0) return [];
  const P = "p:";
  const S = "s:";
  const index = buildSimilarityIndex([
    ...mine.map((n) => ({ ...n, id: P + n.id })),
    ...theirs.map((n) => ({ ...n, id: S + n.id })),
  ]);
  const out: ForYou[] = [];
  const seen = new Set<string>();
  for (const p of index.pairs({ top: 400 })) {
    const [a, b] = p.a.startsWith(P) ? [p.a, p.b] : [p.b, p.a];
    if (!a.startsWith(P) || !b.startsWith(S)) continue;
    // One suggestion per shared note: the best of your notes it meets.
    if (seen.has(b)) continue;
    const match = index.compare(p.a, p.b);
    if (!match) continue;
    seen.add(b);
    out.push({ mine: a.slice(P.length), theirs: b.slice(S.length), score: p.score, shared: match.shared.slice(0, 4) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/**
 * A first draft of the weekly check-in, from the person's own brain — to
 * edit before anything is shared. What it cannot know honestly (what got
 * done this week: completions carry no date) it leaves empty.
 */
export function checkinDraft(input: { notes: NoteLike[]; links: LinkLike[]; now: Date }): { done: string; focus: string; blocker: string } {
  const byId = new Map(input.notes.map((n) => [n.id, n]));
  const focus = computeFocus({ notes: input.notes, links: input.links, now: input.now, limit: 3 })
    .map((f) => byId.get(f.id)?.title)
    .filter(Boolean)
    .map((t) => `• ${t}`)
    .join("\n");
  const tension = input.links.find((l) => l.kind === "tension" && !(l as { resolvedBy?: string | null }).resolvedBy);
  const blocker = tension ? `${byId.get(tension.fromId)?.title ?? ""} ↔ ${byId.get(tension.toId)?.title ?? ""}`.trim() : "";
  return { done: "", focus, blocker: blocker === "↔" ? "" : blocker };
}
