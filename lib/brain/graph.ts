import { words } from "./text";
import { conceptIdf, conceptOverlap, type Concept } from "./concepts";
import type { BrainCategoryId, BrainItemKind } from "@/lib/data/brain";
import { DIRECTED, isLinkOrigin, isRelationKind, type LinkOrigin, type RelationKind } from "./relations";

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
  /** What the note is about, when it has been analysed. */
  concepts?: Concept[];
}

/** A note as the app handles it: text resolved, ready to display or export. */
export interface BrainNote extends NoteLike {
  kind: BrainItemKind;
  ai: boolean;
  concepts: Concept[];
}

export interface LinkLike {
  id?: string;
  fromId: string;
  toId: string;
  /** Absent on connections made before relations had kinds: read as "related". */
  kind?: RelationKind;
  sourceId?: string | null;
  origin?: LinkOrigin;
  reason?: string | null;
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

/** One string per unordered pair — for sets of links and dismissals. */
export function pairKey(a: string, b: string): string {
  return canonicalPair(a, b).join("|");
}

export function sameLink(l: LinkLike, a: string, b: string): boolean {
  return pairKey(l.fromId, l.toId) === pairKey(a, b);
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

/**
 * A connection as the app handles it: every field present. Rows written before
 * migration 008 have no kind, direction or new origin; they read as a plain,
 * undirected "related" connection rather than as something malformed.
 */
export interface BrainLink extends LinkLike {
  id: string;
  reason: string | null;
  origin: LinkOrigin;
  kind: RelationKind;
  sourceId: string | null;
}

export function toBrainLink(row: {
  id: string;
  fromId: string;
  toId: string;
  reason?: string | null;
  origin?: unknown;
  kind?: unknown;
  sourceId?: unknown;
}): BrainLink {
  const kind = isRelationKind(row.kind) ? row.kind : "related";
  const source = typeof row.sourceId === "string" ? row.sourceId.toLowerCase() : null;
  return {
    id: row.id,
    fromId: row.fromId,
    toId: row.toId,
    reason: row.reason ?? null,
    origin: isLinkOrigin(row.origin) ? row.origin : "user",
    kind,
    // A direction only means something for a directed kind, and only when it
    // names one of the two ends.
    sourceId:
      DIRECTED.has(kind) && source && (source === row.fromId.toLowerCase() || source === row.toId.toLowerCase())
        ? source
        : null,
  };
}

/* ── Similarity ───────────────────────────────────────────────────── */

/**
 * Below these, a match is mostly noise.
 *
 * Words: calibrated on a realistic corpus — genuine one-word connections
 * between ordinary notes ("clients" in a goal and in a next step) scored
 * 0.126–0.162, and nothing unrelated scored above zero. An earlier 0.2
 * silently discarded every one of them.
 *
 * Concepts: a note carries at most six, chosen by the model to be specific,
 * so one shared concept out of three or four each already scores 0.25–0.33.
 * 0.2 accepts a single shared specific concept and rejects a shared one
 * diluted among many.
 */
export const SUGGESTION_THRESHOLD = 0.12;
export const CONCEPT_THRESHOLD = 0.2;

export interface Match {
  /** 0–1, the stronger of the word and concept scores. */
  score: number;
  /** The reason, as shown to the person: shared words, or shared concepts. */
  shared: string[];
  via: "words" | "concepts";
}

export interface SimilarityIndex {
  /** How related two notes are, or null when neither signal clears its threshold. */
  compare(aId: string, bId: string, floor?: { words: number; concepts: number }): Match | null;
}

/**
 * Precomputes everything a comparison needs, once per brain: each note's
 * words (title alone, and title plus detail), their rarity across the corpus,
 * and the rarity of each concept. Comparing every pair of a few hundred notes
 * then costs milliseconds.
 *
 * Words use weighted Ochiai similarity, each shared word counting by its
 * rarity (inverse document frequency): two notes that both say "LinkedIn"
 * belong together far more than two that both say "projet". Deterministic,
 * explainable, and needs no model. Concepts, when a note has them, catch what
 * words cannot — synonyms, paraphrase, and the other language.
 */
export function buildSimilarityIndex(notes: NoteLike[]): SimilarityIndex {
  const surfaces = new Map<string, Map<string, string>>();
  const keysOf = (id: string, text: string) => {
    const ws = words(text);
    const known = surfaces.get(id) ?? new Map<string, string>();
    for (const w of ws) if (!known.has(w.key)) known.set(w.key, w.surface);
    surfaces.set(id, known);
    return ws.map((w) => w.key);
  };

  const titles = new Map(notes.map((n) => [n.id, keysOf(n.id, n.title)]));
  const docs = new Map(notes.map((n) => [n.id, keysOf(n.id, `${n.title} ${n.detail ?? ""}`)]));
  const concepts = new Map(notes.map((n) => [n.id, n.concepts ?? []]));

  const df = new Map<string, number>();
  for (const ws of docs.values()) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.size;
  const idf = (w: string) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1;
  const weight = (ws: string[]) => ws.reduce((s, w) => s + idf(w), 0);
  const cidf = conceptIdf(notes);

  const overlap = (a: string[], b: string[]) => {
    if (a.length === 0 || b.length === 0) return { score: 0, shared: [] as string[] };
    const set = new Set(a);
    const shared = b.filter((w) => set.has(w));
    if (shared.length === 0) return { score: 0, shared };
    return { score: weight(shared) / Math.sqrt(weight(a) * weight(b)), shared };
  };

  return {
    compare(aId, bId, floor = { words: SUGGESTION_THRESHOLD, concepts: CONCEPT_THRESHOLD }) {
      const aDoc = docs.get(aId);
      const bDoc = docs.get(bId);
      if (!aDoc || !bDoc || aId === bId) return null;

      // Related if the titles overlap *or* the full texts do. Scoring the full
      // text alone meant that the more carefully a note was written up, the
      // less it connected: a long description dilutes the overlap.
      const byTitle = overlap(titles.get(aId) ?? [], titles.get(bId) ?? []);
      const byDoc = overlap(aDoc, bDoc);
      const lexical = byTitle.score >= byDoc.score ? byTitle : byDoc;
      const semantic = conceptOverlap(concepts.get(aId), concepts.get(bId), cidf);

      const wordsOk = lexical.score >= floor.words;
      const conceptsOk = semantic.score >= floor.concepts;
      if (!wordsOk && !conceptsOk) return null;

      if (conceptsOk && (!wordsOk || semantic.score >= lexical.score)) {
        return {
          score: Math.round(semantic.score * 1000) / 1000,
          shared: semantic.shared.map((c) => c.l),
          via: "concepts",
        };
      }
      // Show the first note's own spelling first; it is the one being looked at.
      const display = (key: string) => surfaces.get(aId)?.get(key) ?? surfaces.get(bId)?.get(key) ?? key;
      return {
        score: Math.round(lexical.score * 1000) / 1000,
        shared: [...lexical.shared].sort((x, y) => idf(y) - idf(x) || x.localeCompare(y)).map(display),
        via: "words",
      };
    },
  };
}

export interface Suggestion extends Match {
  id: string;
}

/**
 * Notes that look related to `target`, strongest first — excluding notes it is
 * already connected to, and pairs the person said are not related.
 */
export function suggestLinks(
  target: NoteLike,
  notes: NoteLike[],
  links: LinkLike[],
  limit = 3,
  dismissed?: ReadonlySet<string>
): Suggestion[] {
  const all = notes.some((n) => n.id === target.id) ? notes : [target, ...notes];
  const index = buildSimilarityIndex(all);
  const already = neighborsOf(target.id, links);

  const out: Suggestion[] = [];
  for (const other of all) {
    if (other.id === target.id || already.has(other.id)) continue;
    if (dismissed?.has(pairKey(target.id, other.id))) continue;
    const match = index.compare(target.id, other.id);
    if (match) out.push({ id: other.id, ...match });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
