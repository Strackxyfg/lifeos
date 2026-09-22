import { extractJson } from "@/lib/ai/json";
import { buildSimilarityIndex, degreeMap, pairKey, type LinkLike, type NoteLike } from "./graph";
import { DIRECTED, isRelationKind, sourceOf, type RelationKind } from "./relations";

/**
 * Weaving: how the second brain connects itself.
 *
 * Three steps, the middle one done by a model and the other two pure (here):
 *
 *   1. rankPairs   — which pairs of notes are worth asking about. Cheap signals
 *                    (shared words, shared concepts, a goal nearby) narrow a
 *                    brain of n notes from n² pairs to a few dozen.
 *   2. (the model) — reads each pair and says whether a real connection
 *                    exists, what kind, which way, how sure, and why.
 *   3. planLinks   — keeps only confident verdicts, caps how many connections
 *                    one run may add, and resolves direction.
 *
 * Nothing the model says is trusted as-is: verdicts are parsed defensively,
 * pair numbers checked against what was asked, kinds validated, confidence
 * clamped, reasons clipped.
 */

export interface PairCandidate {
  a: string;
  b: string;
  /** Pre-model relevance, 0–1. Orders the pairs; the model decides. */
  score: number;
  via: "words" | "concepts" | "goal";
}

/**
 * Looser than the suggestion thresholds on purpose: these pairs go to a model
 * that judges them, so recall matters more than precision here.
 */
const CANDIDATE_FLOOR = { words: 0.06, concepts: 0.1 };

/** Open goals each focused note is checked against, even with no word in common. */
const GOALS_PER_NOTE = 3;

/** Whole-brain runs weave around this many unconnected notes first. */
const ORPHANS_PER_RUN = 8;

interface RankInput {
  notes: NoteLike[];
  links: LinkLike[];
  dismissed: ReadonlySet<string>;
  /** Weave around these notes only. Absent: the whole brain. */
  focusIds?: string[];
  limit: number;
  /** Similar notes considered per focused note (goals come on top). */
  perNote?: number;
}

interface Ctx {
  byId: Map<string, NoteLike>;
  alive: NoteLike[];
  taken: Set<string>;
  index: ReturnType<typeof buildSimilarityIndex>;
}

/**
 * Which pairs to put to the model.
 *
 * Focused on given notes: for each, its most similar notes, then the open
 * goals it is most likely to serve — a step toward a goal rarely shares its
 * words ("Call Marc" vs "Sign 10 clients"), so goals are always asked about.
 *
 * Whole brain: first the most recent notes connected to nothing, each with
 * its closest note and its likeliest goal — that is where a forgotten step or
 * a constraint in tension hides — then the strongest pairs anywhere. Each run
 * leaves fewer unconnected notes, so repeated runs work through a large brain.
 *
 * Lists are interleaved note by note, so a limit cuts every note's least
 * promising pairs rather than every pair of the last notes.
 */
export function rankPairs(input: RankInput): PairCandidate[] {
  const { notes, links, dismissed, focusIds, limit, perNote = 5 } = input;
  const ctx: Ctx = {
    byId: new Map(notes.map((n) => [n.id, n])),
    // Finished notes are history: a reached goal or a done step needs no new
    // connections. A focused note is woven whatever its state.
    alive: notes.filter((n) => !n.done),
    taken: new Set([...links.map((l) => pairKey(l.fromId, l.toId)), ...dismissed]),
    index: buildSimilarityIndex(notes),
  };

  if (focusIds?.length) {
    return interleave(focusIds.map((id) => around(ctx, id, perNote, GOALS_PER_NOTE)), limit);
  }

  const degree = degreeMap(links);
  const orphans = ctx.alive
    .filter((n) => !degree.get(n.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, ORPHANS_PER_RUN)
    .map((n) => n.id);
  const first = interleave(orphans.map((id) => around(ctx, id, 1, 1)), Math.ceil((limit * 2) / 3));
  const seen = new Set(first.map((p) => pairKey(p.a, p.b)));
  return [...first, ...strongest(ctx).filter((p) => !seen.has(pairKey(p.a, p.b)))].slice(0, limit);
}

/** The best candidates around one note: its most similar notes, then its likeliest goals. */
function around(ctx: Ctx, id: string, similar: number, goals: number): PairCandidate[] {
  const f = ctx.byId.get(id);
  if (!f) return [];
  const free = (o: NoteLike) => o.id !== f.id && !ctx.taken.has(pairKey(f.id, o.id));

  const scored: PairCandidate[] = [];
  for (const other of ctx.alive) {
    if (!free(other)) continue;
    const m = ctx.index.compare(f.id, other.id, CANDIDATE_FLOOR);
    if (m) scored.push({ a: f.id, b: other.id, score: m.score, via: m.via });
  }
  scored.sort((x, y) => y.score - x.score || x.b.localeCompare(y.b));
  const chosen = scored.slice(0, similar);

  if (f.category !== "goals" && goals > 0) {
    // Ranked by whatever faint signal there is, then by recency.
    const candidates = ctx.alive
      .filter((g) => g.category === "goals" && free(g) && !chosen.some((c) => c.b === g.id))
      .map((g) => ({ g, score: ctx.index.compare(f.id, g.id, { words: 0, concepts: 0 })?.score ?? 0 }))
      .sort((x, y) => y.score - x.score || y.g.createdAt.localeCompare(x.g.createdAt) || x.g.id.localeCompare(y.g.id))
      .slice(0, goals);
    for (const { g, score } of candidates) chosen.push({ a: f.id, b: g.id, score, via: "goal" });
  }
  return chosen;
}

/** Every pair above the floor, strongest first, at most six per note. */
function strongest(ctx: Ctx): PairCandidate[] {
  const all: PairCandidate[] = [];
  for (let i = 0; i < ctx.alive.length; i++) {
    for (let j = i + 1; j < ctx.alive.length; j++) {
      const a = ctx.alive[i];
      const b = ctx.alive[j];
      if (ctx.taken.has(pairKey(a.id, b.id))) continue;
      const m = ctx.index.compare(a.id, b.id, CANDIDATE_FLOOR);
      if (m) all.push({ a: a.id, b: b.id, score: m.score, via: m.via });
    }
  }
  all.sort((x, y) => y.score - x.score || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)));
  const count = new Map<string, number>();
  return all.filter((p) => {
    const ca = count.get(p.a) ?? 0;
    const cb = count.get(p.b) ?? 0;
    if (ca >= 6 || cb >= 6) return false;
    count.set(p.a, ca + 1);
    count.set(p.b, cb + 1);
    return true;
  });
}

/** Round-robin across lists, skipping pairs already taken, up to `limit`. */
function interleave(lists: PairCandidate[][], limit: number): PairCandidate[] {
  const out: PairCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const p = list[i];
      if (!p) continue;
      const key = pairKey(p.a, p.b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
      if (out.length === limit) break;
    }
  }
  return out;
}

/* ── Verdicts ─────────────────────────────────────────────────────── */

export interface Verdict {
  /** 1-based index into the pairs that were asked about. */
  pair: number;
  connect: boolean;
  kind: RelationKind;
  /** For directed kinds: which of the two notes (A = first) the relation starts from. */
  from: "A" | "B" | null;
  confidence: number;
  reason: string;
}

const MAX_REASON = 160;

function cleanReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.replace(/\s+/g, " ").trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
  return text.length <= MAX_REASON ? text : `${text.slice(0, MAX_REASON - 1).trimEnd()}…`;
}

function toConfidence(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  // Some models answer in percent.
  const v = n > 1 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, v));
}

/**
 * The model's verdicts, validated. Accepts `{ verdicts: [...] }` or a bare
 * array; ignores entries for pairs that were not asked about, duplicates, and
 * anything unreadable.
 */
export function parseVerdicts(raw: string, pairCount: number): Verdict[] {
  const data = extractJson(raw);
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { verdicts?: unknown }).verdicts)
      ? (data as { verdicts: unknown[] }).verdicts
      : [];

  const out: Verdict[] = [];
  const seen = new Set<number>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const pair = typeof o.pair === "number" ? o.pair : Number.parseInt(String(o.pair ?? ""), 10);
    if (!Number.isInteger(pair) || pair < 1 || pair > pairCount || seen.has(pair)) continue;
    seen.add(pair);

    const connect = o.connect === true || o.connect === "true";
    const kindRaw = typeof o.kind === "string" ? o.kind.toLowerCase().trim() : "";
    const kind: RelationKind = isRelationKind(kindRaw) ? kindRaw : "related";
    const fromRaw = typeof o.from === "string" ? o.from.trim().toUpperCase() : "";
    const from = DIRECTED.has(kind) && (fromRaw === "A" || fromRaw === "B") ? fromRaw : null;

    out.push({ pair, connect, kind, from, confidence: toConfidence(o.confidence), reason: cleanReason(o.reason) });
  }
  return out;
}

/* ── Planning ─────────────────────────────────────────────────────── */

/**
 * How sure the model must be before a connection is drawn without asking.
 * Everything it draws is still marked for review, and a removal is
 * remembered; these only keep the review list worth reading. "Related" asks
 * for more certainty than the typed kinds: it is the vaguest claim.
 *
 * Calibrated on a realistic mixed French/English brain: verdicts at 0.85 and
 * above were all sound; those at 0.75–0.82 were the loose ones ("both are
 * about clients"). Precision matters more than recall here — the person can
 * always connect by hand, and a noisy engine teaches them to ignore it.
 */
export const AUTO_LINK = { min: 0.8, related: 0.85, perNote: 3, total: 12 } as const;

export interface PlannedLink {
  a: string;
  b: string;
  kind: RelationKind;
  sourceId: string | null;
  reason: string;
  confidence: number;
}

export function planLinks(
  pairs: PairCandidate[],
  verdicts: Verdict[],
  notes: NoteLike[],
  limits: { min: number; related: number; perNote: number; total: number } = AUTO_LINK
): PlannedLink[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const perNote = new Map<string, number>();
  const out: PlannedLink[] = [];

  const confident = verdicts
    .filter((v) => v.connect && v.reason && v.confidence >= (v.kind === "related" ? limits.related : limits.min))
    .sort((x, y) => y.confidence - x.confidence || x.pair - y.pair);

  for (const v of confident) {
    if (out.length >= limits.total) break;
    const pair = pairs[v.pair - 1];
    const A = pair && byId.get(pair.a);
    const B = pair && byId.get(pair.b);
    if (!A || !B) continue;
    if ((perNote.get(A.id) ?? 0) >= limits.perNote || (perNote.get(B.id) ?? 0) >= limits.perNote) continue;

    const explicit = v.from === "A" ? A.id : v.from === "B" ? B.id : null;
    out.push({
      a: A.id,
      b: B.id,
      kind: v.kind,
      sourceId: sourceOf(v.kind, A, B, explicit),
      reason: v.reason,
      confidence: v.confidence,
    });
    perNote.set(A.id, (perNote.get(A.id) ?? 0) + 1);
    perNote.set(B.id, (perNote.get(B.id) ?? 0) + 1);
  }
  return out;
}
