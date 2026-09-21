import { words } from "./text";
import type { BrainCategoryId, BrainItemKind } from "@/lib/data/brain";

/**
 * The second brain as a graph: notes are nodes, links are synapses.
 *
 * Everything here is pure — no I/O, no clock unless passed in — so it runs the
 * same on the server, in the browser and under test.
 */

/** The fields graph logic needs. Satisfied by a stored note. */
export interface NoteLike {
  id: string;
  category: BrainCategoryId;
  /** Resolved text. Seeded demo notes resolve theirs from i18n first. */
  title: string;
  detail?: string | null;
  done: boolean;
  createdAt: string;
}

/** A note as the app handles it: text resolved, ready to display or export. */
export interface BrainNote extends NoteLike {
  kind: BrainItemKind;
  ai: boolean;
}

export interface LinkLike {
  id?: string;
  fromId: string;
  toId: string;
}

/**
 * A link is undirected — a synapse, not a pointer. It is stored once, with the
 * smaller id first, so A–B and B–A cannot both exist.
 *
 * The database enforces the same order with `check (from_id < to_id)` on the
 * uuid type, which compares bytes. JavaScript string order agrees with that for
 * uuids of one case — verified against Postgres on 2,000 generated ids — but
 * not for mixed case, where "a" sorts after "B". Postgres stores uuids
 * lowercase, so lowercase them here too; otherwise an id typed by hand (say,
 * through MCP) could produce a pair the database rejects.
 */
export function canonicalPair(a: string, b: string): [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

export function sameLink(l: LinkLike, a: string, b: string): boolean {
  const [x, y] = canonicalPair(a, b);
  const [p, q] = canonicalPair(l.fromId, l.toId);
  return x === p && y === q;
}

/** Ids of every note linked to `id`. */
export function neighborsOf(id: string, links: LinkLike[]): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (l.fromId === id) out.add(l.toId);
    else if (l.toId === id) out.add(l.fromId);
  }
  return out;
}

/** How many links each note has. Absent means zero — an orphan. */
export function degreeMap(links: LinkLike[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const l of links) {
    d.set(l.fromId, (d.get(l.fromId) ?? 0) + 1);
    d.set(l.toId, (d.get(l.toId) ?? 0) + 1);
  }
  return d;
}

/** Drops links pointing at notes that are gone, so nothing renders dangling. */
export function liveLinks<L extends LinkLike>(links: L[], notes: { id: string }[]): L[] {
  const ids = new Set(notes.map((n) => n.id));
  return links.filter((l) => ids.has(l.fromId) && ids.has(l.toId) && l.fromId !== l.toId);
}

export interface Suggestion {
  id: string;
  /** 0–1. Weighted overlap of the two notes' vocabularies. */
  score: number;
  /**
   * The shared words, most distinctive first — the reason for the suggestion.
   * Shown to the user, so they are the words as written ("études"), not the
   * folded comparison keys ("etude").
   */
  shared: string[];
}

/**
 * Below this, suggestions are mostly noise.
 *
 * Calibrated on a realistic corpus rather than guessed: genuine one-word
 * connections between ordinary notes ("clients" in a goal and in a next step)
 * scored 0.126–0.162, and nothing unrelated scored above zero at all. An
 * earlier value of 0.2 silently discarded every one of them. As a corpus
 * grows, inverse document frequency pushes common words down on its own, so
 * the threshold does not need to rise with it.
 */
export const SUGGESTION_THRESHOLD = 0.12;

/**
 * Notes that look related to `target`, strongest first.
 *
 * Weighted Ochiai similarity: each shared word counts by its rarity across the
 * user's own notes (inverse document frequency). Two notes that both mention
 * "LinkedIn" are far more likely to belong together than two that both say
 * "projet". Deterministic, explainable, and needs no model — so it works the
 * same with or without an AI key.
 */
export function suggestLinks(
  target: NoteLike,
  notes: NoteLike[],
  links: LinkLike[],
  limit = 3
): Suggestion[] {
  const surfaces = new Map<string, Map<string, string>>();
  const keysOf = (id: string, text: string) => {
    const ws = words(text);
    const known = surfaces.get(id) ?? new Map<string, string>();
    for (const w of ws) if (!known.has(w.key)) known.set(w.key, w.surface);
    surfaces.set(id, known);
    return ws.map((w) => w.key);
  };

  // Two views of each note: its title alone, and title plus detail.
  const titles = new Map(notes.map((n) => [n.id, keysOf(n.id, n.title)]));
  const docs = new Map(notes.map((n) => [n.id, keysOf(n.id, `${n.title} ${n.detail ?? ""}`)]));

  // Document frequency over the user's corpus.
  const df = new Map<string, number>();
  for (const ws of docs.values()) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.size;
  const idf = (w: string) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1;
  const weight = (ws: string[]) => ws.reduce((s, w) => s + idf(w), 0);

  /** Weighted Ochiai overlap of two word lists, with the words they share. */
  const similarity = (a: string[], b: string[]) => {
    if (a.length === 0 || b.length === 0) return { score: 0, shared: [] as string[] };
    const set = new Set(a);
    const shared = b.filter((w) => set.has(w));
    if (shared.length === 0) return { score: 0, shared };
    return { score: weight(shared) / Math.sqrt(weight(a) * weight(b)), shared };
  };

  const mineTitle = titles.get(target.id) ?? keysOf(target.id, target.title);
  const mineDoc = docs.get(target.id) ?? keysOf(target.id, `${target.title} ${target.detail ?? ""}`);
  if (mineDoc.length === 0) return [];
  const already = neighborsOf(target.id, links);

  const out: Suggestion[] = [];
  for (const other of notes) {
    if (other.id === target.id || already.has(other.id)) continue;

    // Related if the titles overlap *or* the full texts do. Scoring the full
    // text alone meant that the more carefully a note was written up, the
    // less it connected: a long description dilutes the overlap, and a goal
    // with a paragraph under it stopped linking to the steps that serve it.
    const byTitle = similarity(mineTitle, titles.get(other.id) ?? []);
    const byDoc = similarity(mineDoc, docs.get(other.id) ?? []);
    const best = byTitle.score >= byDoc.score ? byTitle : byDoc;

    const score = best.score;
    const shared = best.shared;
    if (score < SUGGESTION_THRESHOLD) continue;

    // Show the target note's own spelling first; it is the one being looked at.
    const display = (key: string) =>
      surfaces.get(target.id)?.get(key) ?? surfaces.get(other.id)?.get(key) ?? key;

    out.push({
      id: other.id,
      score: Math.round(score * 1000) / 1000,
      shared: [...shared].sort((a, b) => idf(b) - idf(a) || a.localeCompare(b)).map(display),
    });
  }

  return out
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
