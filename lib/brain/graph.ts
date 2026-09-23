import { words } from "./text";
import { conceptOverlap, conceptTerms, type Concept } from "./concepts";
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

export interface PairMatch {
  a: string;
  b: string;
  score: number;
  via: "words" | "concepts";
}

export interface SimilarityIndex {
  /** How related two notes are, or null when neither signal clears its threshold. */
  compare(aId: string, bId: string, floor?: { words: number; concepts: number }): Match | null;
  /**
   * Every pair among `ids` (default: all notes) whose score clears the floor,
   * with exactly the score `compare` gives — found through an inverted index,
   * so only notes that share a term are ever compared.
   *
   * Terms shared by more than `maxDf` notes are too common to *generate*
   * pairs (a pair still gets their full weight once another term brings it
   * in). Pairs related only through such terms — the brain's most common
   * words and concepts — are therefore skipped here; per-note weaving
   * (`compare` against every note) still finds them.
   */
  pairs(opts?: PairsOptions): PairMatch[];
}

export interface PairsOptions {
  ids?: string[];
  floor?: { words: number; concepts: number };
  maxDf?: number;
  /**
   * Keep only the best `top` pairs (score, then pair key, for determinism).
   * A loose floor lets hundreds of thousands of pairs through in a large
   * brain; building and sorting all of them cost more than finding them.
   */
  top?: number;
}

/** Strongest first; equal scores in pair-key order, so every run agrees. */
export function comparePairs(x: PairMatch, y: PairMatch): number {
  return y.score - x.score || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b));
}

/**
 * The `k` best items seen, kept in a binary min-heap: the worst kept item is
 * at the root, so a candidate is compared once and discarded without
 * allocation when it would not make the cut. `better(x, y)` < 0 when x ranks
 * above y.
 */
export class TopK<T> {
  private heap: T[] = [];
  constructor(private readonly k: number, private readonly better: (x: T, y: T) => number) {}

  push(item: T): void {
    if (this.k <= 0) return;
    const h = this.heap;
    if (h.length < this.k) {
      h.push(item);
      let i = h.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.better(h[p], h[i]) >= 0) break; // parent is already the worse one
        [h[p], h[i]] = [h[i], h[p]];
        i = p;
      }
      return;
    }
    if (this.better(item, h[0]) >= 0) return;
    h[0] = item;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let worst = i;
      if (l < h.length && this.better(h[l], h[worst]) > 0) worst = l;
      if (r < h.length && this.better(h[r], h[worst]) > 0) worst = r;
      if (worst === i) break;
      [h[worst], h[i]] = [h[i], h[worst]];
      i = worst;
    }
  }

  /** Best first. */
  sorted(): T[] {
    return [...this.heap].sort(this.better);
  }
}

interface Indexed {
  id: string;
  title: string[];
  doc: string[];
  titleSet: Set<string>;
  docSet: Set<string>;
  titleW: number;
  docW: number;
  cterms: string[];
  cset: Set<string>;
  cW: number;
  concepts: Concept[];
  surfaces: Map<string, string>;
}

const DEFAULT_FLOOR = { words: SUGGESTION_THRESHOLD, concepts: CONCEPT_THRESHOLD };

/**
 * Precomputes everything a comparison needs, once per brain: each note's
 * words (title alone, and title plus detail) as sets, their rarity across the
 * corpus, each note's total weight, and the same for concepts. A comparison
 * then allocates nothing, and `pairs` walks an inverted index instead of every
 * pair: at 4,000 notes the whole-brain scan went from 107 s to well under a
 * second (measured 2026-09-23).
 *
 * Words use weighted Ochiai similarity, each shared word counting by its
 * rarity (inverse document frequency): two notes that both say "LinkedIn"
 * belong together far more than two that both say "projet". Deterministic,
 * explainable, and needs no model. Concepts, when a note has them, catch what
 * words cannot — synonyms, paraphrase, and the other language.
 */
export function buildSimilarityIndex(notes: NoteLike[]): SimilarityIndex {
  const df = new Map<string, number>();
  const cdf = new Map<string, number>();
  const raw = notes.map((n) => {
    const surfaces = new Map<string, string>();
    const keysOf = (text: string) => {
      const ws = words(text);
      for (const w of ws) if (!surfaces.has(w.key)) surfaces.set(w.key, w.surface);
      return ws.map((w) => w.key);
    };
    const title = keysOf(n.title);
    const doc = keysOf(`${n.title} ${n.detail ?? ""}`);
    const cterms = conceptTerms(n.concepts);
    for (const w of doc) df.set(w, (df.get(w) ?? 0) + 1);
    for (const t of cterms) cdf.set(t, (cdf.get(t) ?? 0) + 1);
    return { n, title, doc, cterms, surfaces };
  });

  const N = notes.length;
  const idf = (w: string) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1;
  const cidf = (t: string) => Math.log((N + 1) / ((cdf.get(t) ?? 0) + 1)) + 1;
  const sum = (xs: string[], f: (x: string) => number) => {
    let t = 0;
    for (const x of xs) t += f(x);
    return t;
  };

  const items: Indexed[] = raw.map(({ n, title, doc, cterms, surfaces }) => ({
    id: n.id,
    title,
    doc,
    titleSet: new Set(title),
    docSet: new Set(doc),
    titleW: sum(title, idf),
    docW: sum(doc, idf),
    cterms,
    cset: new Set(cterms),
    cW: sum(cterms, cidf),
    concepts: n.concepts ?? [],
    surfaces,
  }));
  const pos = new Map(items.map((it, i) => [it.id, i]));

  /** Shared weight of two term lists, iterating the smaller against the other's set. */
  const sharedWeight = (a: string[], bSet: Set<string>, f: (x: string) => number) => {
    let t = 0;
    for (const x of a) if (bSet.has(x)) t += f(x);
    return t;
  };
  const cosine = (shared: number, wa: number, wb: number) => (shared > 0 && wa > 0 && wb > 0 ? shared / Math.sqrt(wa * wb) : 0);

  /**
   * The decision `compare` makes, from the three scores: related if the
   * titles overlap *or* the full texts do (a long description would dilute a
   * full-text overlap — the more carefully a note was written, the less it
   * connected), or if the concepts do; concepts win a tie.
   */
  const decide = (title: number, doc: number, concept: number, floor: { words: number; concepts: number }) => {
    const lexical = Math.max(title, doc);
    const wordsOk = lexical >= floor.words;
    const conceptsOk = concept >= floor.concepts;
    if (!wordsOk && !conceptsOk) return null;
    return conceptsOk && (!wordsOk || concept >= lexical)
      ? { score: concept, via: "concepts" as const }
      : { score: lexical, via: "words" as const, byTitle: title >= doc };
  };

  const round = (x: number) => Math.round(x * 1000) / 1000;

  function compare(aId: string, bId: string, floor = DEFAULT_FLOOR): Match | null {
    const ia = pos.get(aId);
    const ib = pos.get(bId);
    if (ia === undefined || ib === undefined || ia === ib) return null;
    const A = items[ia];
    const B = items[ib];
    if (A.doc.length === 0 || B.doc.length === 0) {
      // No words on one side: only concepts can relate them.
      if (!A.cterms.length || !B.cterms.length) return null;
    }
    const title = cosine(sharedWeight(A.title, B.titleSet, idf), A.titleW, B.titleW);
    const doc = cosine(sharedWeight(A.doc, B.docSet, idf), A.docW, B.docW);
    const concept = cosine(sharedWeight(A.cterms, B.cset, cidf), A.cW, B.cW);
    const d = decide(title, doc, concept, floor);
    if (!d) return null;

    if (d.via === "concepts") {
      // The concepts that carry the shared terms, in the first note's words.
      const carriers = conceptOverlap(A.concepts, B.concepts, cidf).shared;
      return { score: round(d.score), shared: carriers.map((c) => c.l), via: "concepts" };
    }
    const keys = (d.byTitle ? B.title.filter((w) => A.titleSet.has(w)) : B.doc.filter((w) => A.docSet.has(w)))
      .sort((x, y) => idf(y) - idf(x) || x.localeCompare(y));
    // Show the first note's own spelling first; it is the one being looked at.
    const display = (key: string) => A.surfaces.get(key) ?? B.surfaces.get(key) ?? key;
    return { score: round(d.score), shared: keys.map(display), via: "words" };
  }

  function pairs(opts: PairsOptions = {}): PairMatch[] {
    const floor = opts.floor ?? DEFAULT_FLOOR;
    const maxDf = opts.maxDf ?? Math.max(40, Math.ceil(4 * Math.sqrt(N)));
    const scope = (opts.ids ?? items.map((it) => it.id))
      .map((id) => pos.get(id))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);
    const inScope = new Uint8Array(items.length);
    for (const i of scope) inScope[i] = 1;

    // Postings over the notes in scope, ascending — so each pair is met once, from its smaller end.
    const post = (field: "title" | "doc" | "cterms") => {
      const m = new Map<string, number[]>();
      for (const i of scope) for (const t of items[i][field]) (m.get(t) ?? m.set(t, []).get(t)!).push(i);
      return m;
    };
    const pTitle = post("title");
    const pDoc = post("doc");
    const pConcept = post("cterms");

    const accT = new Float64Array(items.length);
    const accD = new Float64Array(items.length);
    const accC = new Float64Array(items.length);
    const touched: number[] = [];
    const mark = new Uint8Array(items.length);
    const out: PairMatch[] = [];
    const best = opts.top !== undefined ? new TopK<PairMatch>(opts.top, comparePairs) : null;

    for (const i of scope) {
      const A = items[i];
      const walk = (terms: string[], postings: Map<string, number[]>, acc: Float64Array, weight: (t: string) => number, capped: string[]) => {
        for (const t of terms) {
          const list = postings.get(t);
          if (!list) continue;
          if (list.length > maxDf) {
            capped.push(t);
            continue;
          }
          const w = weight(t);
          for (const j of list) {
            if (j <= i) continue;
            acc[j] += w;
            if (!mark[j]) {
              mark[j] = 1;
              touched.push(j);
            }
          }
        }
      };
      const cT: string[] = [];
      const cD: string[] = [];
      const cC: string[] = [];
      walk(A.title, pTitle, accT, idf, cT);
      walk(A.doc, pDoc, accD, idf, cD);
      walk(A.cterms, pConcept, accC, cidf, cC);

      for (const j of touched) {
        const B = items[j];
        // Common terms did not generate the pair, but they still count in it.
        let t = accT[j];
        let dd = accD[j];
        let c = accC[j];
        for (const x of cT) if (B.titleSet.has(x)) t += idf(x);
        for (const x of cD) if (B.docSet.has(x)) dd += idf(x);
        for (const x of cC) if (B.cset.has(x)) c += cidf(x);
        const d = decide(cosine(t, A.titleW, B.titleW), cosine(dd, A.docW, B.docW), cosine(c, A.cW, B.cW), floor);
        if (d) {
          const pair: PairMatch = { a: A.id, b: B.id, score: round(d.score), via: d.via };
          if (best) best.push(pair);
          else out.push(pair);
        }
        accT[j] = 0;
        accD[j] = 0;
        accC[j] = 0;
        mark[j] = 0;
      }
      touched.length = 0;
    }
    return best ? best.sorted() : out;
  }

  return { compare, pairs };
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
  dismissed?: ReadonlySet<string>,
  /** Built once per brain by the caller, when it compares many notes. Must include `target`. */
  prebuilt?: SimilarityIndex
): Suggestion[] {
  const all = notes.some((n) => n.id === target.id) ? notes : [target, ...notes];
  const index = prebuilt ?? buildSimilarityIndex(all);
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
