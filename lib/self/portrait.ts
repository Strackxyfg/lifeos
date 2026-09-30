import { normalize, tokens } from "@/lib/brain/text";

/**
 * The portrait: what the double understands of the person.
 *
 * A trait is a short statement about them ("Vous travaillez mieux le
 * matin"), in one of eight dimensions, resting on their own words — quotes
 * from their notes. Three rules make it trustworthy:
 *
 *  1. No quote, no trait. Every quote is checked here, word for word, against
 *     the note it cites; a model's claim that someone "said" something is
 *     never taken on trust. A trait left with no quote is dropped.
 *  2. The person has the last word. A trait arrives proposed; they confirm
 *     it, correct it (it becomes theirs) or reject it. A rejected trait is
 *     remembered, and nothing close to it is ever proposed again.
 *  3. Nothing outlives its source. When a note is deleted or rewritten, the
 *     quotes taken from it go; a proposal left with none goes with them.
 *
 * Pure: no I/O, no clock unless passed in — tested line by line.
 */

export const DIMENSIONS = ["values", "drives", "strengths", "obstacles", "rhythms", "principles", "people", "interests"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export function isDimension(v: unknown): v is Dimension {
  return typeof v === "string" && (DIMENSIONS as readonly string[]).includes(v);
}

export type TraitStatus = "proposed" | "confirmed" | "rejected";
export type TraitOrigin = "ai" | "person";

/** Their words a trait rests on: a note, and the passage quoted from it. */
export interface Evidence {
  noteId: string;
  quote: string;
}

export interface TraitLike {
  id: string;
  dimension: Dimension;
  statement: string;
  evidence: Evidence[];
  status: TraitStatus;
  origin: TraitOrigin;
  key: string;
  createdAt: string;
  updatedAt: string;
}

export const PORTRAIT_LIMITS = {
  /** Characters in a statement. */
  statement: 200,
  /** Characters in a quote. */
  quote: 240,
  /** Quotes kept per trait (the database allows 12). */
  evidence: 8,
  /** New traits one reading may propose. */
  perRun: 8,
  /** Words a quote needs to say something: "le matin" alone proves nothing. */
  quoteWords: 3,
} as const;

/**
 * A French statement that gives the person a gender: a past participle
 * agreeing after "vous êtes" ("vous êtes intéressé", "passionnée"). The
 * product never assumes one; such a statement is set aside, and the prompt
 * asks for the turn that needs none ("L'entrepreneuriat vous intéresse").
 */
export function gendered(statement: string): boolean {
  return /\bvous (?:êtes|étiez|serez|seriez|êtes souvent|êtes très|êtes plutôt)\s+(?:très\s+|plus\s+|souvent\s+|plutôt\s+|assez\s+)?\p{L}+(?:é|ée|és|ées)(?![\p{L}])/iu.test(statement);
}

/** Two statements this alike (shared stems over all stems) are the same trait. */
export const SAME_TRAIT = 0.6;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Lowercase, accents and punctuation gone, single spaces: what quotes are compared on. */
const flat = (s: string) => normalize(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** First five letters of each meaningful word: "travaille" meets "travailler", "matinées" meets "matin". */
const stems = (s: string) => new Set(tokens(s).map((t) => t.slice(0, 5)));

/** A statement's meaningful words, normalised, in order: how the same trait is recognised. */
export function traitKey(statement: string): string {
  return tokens(statement).join(" ").slice(0, 240);
}

/** How alike two statements are: shared stems over all stems (0–1). */
export function likeness(a: string, b: string): number {
  const x = stems(a);
  const y = stems(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const s of x) if (y.has(s)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * Whether `quote` is really in `text`: whole words, ignoring case, accents
 * and punctuation. Fragments joined by "…" must each be found. A quote under
 * three words is not evidence of anything.
 */
export function quoteIn(quote: string, text: string): boolean {
  const fragments = quote.split(/\.{3}|…/).map(flat).filter(Boolean);
  if (fragments.length === 0) return false;
  if (fragments.join(" ").split(" ").length < PORTRAIT_LIMITS.quoteWords) return false;
  const hay = ` ${flat(text)} `;
  return fragments.every((f) => hay.includes(` ${f} `));
}

/** A note's text, as quotes are checked against it. */
export function noteText(n: { title: string; detail?: string | null }): string {
  return `${n.title}\n${n.detail ?? ""}`;
}

const evidenceKey = (e: Evidence) => `${e.noteId}|${flat(e.quote)}`;

/** Quotes, without repeats, capped — those already held first. */
export function mergeEvidence(held: Evidence[], added: Evidence[], max: number = PORTRAIT_LIMITS.evidence): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of [...held, ...added]) {
    const k = evidenceKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/** The quotes still true: their note exists, and still says it. */
export function liveEvidence(evidence: Evidence[], texts: Map<string, string>): Evidence[] {
  return evidence.filter((e) => {
    const text = texts.get(e.noteId);
    return text !== undefined && quoteIn(e.quote, text);
  });
}

/** Stored evidence, validated on the way out like any other input. */
export function sanitizeEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): Evidence[] => {
    const o = (x ?? {}) as Record<string, unknown>;
    if (typeof o.noteId !== "string" || typeof o.quote !== "string") return [];
    const noteId = o.noteId.slice(0, 64);
    const quote = clip(oneLine(o.quote), PORTRAIT_LIMITS.quote);
    return noteId && quote ? [{ noteId, quote }] : [];
  });
}

/* ── Reading the model's answer ───────────────────────────────────── */

/** What the model was shown, by the short references it answers with. */
export interface ExtractionContext {
  /** "n1" → the note: its id and its text. */
  notes: Map<string, { id: string; text: string }>;
  /** "t1" → a trait it was shown as already known (never a rejected one). */
  known: Map<string, TraitLike>;
  /** Every trait the person has, rejected ones included. */
  all: TraitLike[];
}

export interface Proposal {
  dimension: Dimension;
  statement: string;
  key: string;
  evidence: Evidence[];
}

export interface Extraction {
  /** New traits, to be stored as proposed. */
  proposals: Proposal[];
  /** New quotes for traits already held. */
  support: { traitId: string; evidence: Evidence[] }[];
  /** What was thrown away, and why — for tests and for the log. */
  dropped: { reason: "unquoted" | "rejected-before" | "invalid" | "over-limit" | "gendered"; statement?: string }[];
}

/**
 * The model's answer, validated. Never throws. Expects
 * `{"traits":[{"dimension","statement","evidence":[{"note","quote"}]} | {"existing","evidence"}]}`.
 */
export function sanitizeTraits(raw: unknown, ctx: ExtractionContext): Extraction {
  const out: Extraction = { proposals: [], support: [], dropped: [] };
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { traits?: unknown } | null)?.traits) ? (raw as { traits: unknown[] }).traits : [];
  const supportOf = new Map<string, Evidence[]>();
  const addSupport = (traitId: string, evidence: Evidence[]) => {
    supportOf.set(traitId, mergeEvidence(supportOf.get(traitId) ?? [], evidence));
  };

  for (const item of list.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;

    // Quotes first: whatever the item claims, it is worth only what it can quote.
    const evidence: Evidence[] = [];
    for (const e of Array.isArray(o.evidence) ? o.evidence.slice(0, 8) : []) {
      const x = (e ?? {}) as Record<string, unknown>;
      const note = typeof x.note === "string" ? ctx.notes.get(x.note.trim()) : undefined;
      if (!note || typeof x.quote !== "string") continue;
      const quote = clip(oneLine(x.quote.replace(/^["«“]+|["»”]+$/g, "")), PORTRAIT_LIMITS.quote);
      if (quoteIn(quote, note.text)) evidence.push({ noteId: note.id, quote });
    }
    const kept = mergeEvidence([], evidence, 5);

    // More evidence for a trait it was shown.
    if (typeof o.existing === "string") {
      const trait = ctx.known.get(o.existing.trim());
      if (trait && kept.length > 0) addSupport(trait.id, kept);
      else out.dropped.push({ reason: trait ? "unquoted" : "invalid" });
      continue;
    }

    if (!isDimension(o.dimension) || typeof o.statement !== "string") {
      out.dropped.push({ reason: "invalid" });
      continue;
    }
    const statement = clip(oneLine(o.statement), PORTRAIT_LIMITS.statement);
    const key = traitKey(statement);
    if (statement.length < 8 || !key) {
      out.dropped.push({ reason: "invalid", statement });
      continue;
    }
    if (gendered(statement)) {
      out.dropped.push({ reason: "gendered", statement });
      continue;
    }
    if (kept.length === 0) {
      out.dropped.push({ reason: "unquoted", statement });
      continue;
    }

    // The same trait, said again: in the portrait already, or rejected before.
    const same = ctx.all
      .filter((t) => t.dimension === o.dimension || t.status === "rejected")
      .map((t) => ({ t, score: t.key === key ? 1 : likeness(t.statement, statement) }))
      .filter((x) => x.score >= SAME_TRAIT)
      .sort((a, b) => b.score - a.score)[0];
    if (same?.t.status === "rejected") {
      out.dropped.push({ reason: "rejected-before", statement });
      continue;
    }
    if (same) {
      addSupport(same.t.id, kept);
      continue;
    }

    // The same trait twice in one answer: one proposal, both quotes.
    const twin = out.proposals.find((p) => p.dimension === o.dimension && (p.key === key || likeness(p.statement, statement) >= SAME_TRAIT));
    if (twin) {
      twin.evidence = mergeEvidence(twin.evidence, kept);
      continue;
    }
    if (out.proposals.length >= PORTRAIT_LIMITS.perRun) {
      out.dropped.push({ reason: "over-limit", statement });
      continue;
    }
    out.proposals.push({ dimension: o.dimension, statement, key, evidence: kept });
  }

  out.support = [...supportOf.entries()].map(([traitId, evidence]) => ({ traitId, evidence }));
  return out;
}

/* ── Keeping it true ─────────────────────────────────────────────── */

export interface TraitChanges {
  update: { id: string; evidence: Evidence[] }[];
  remove: string[];
}

/**
 * What a note's deletion — or its rewriting, with the note's new text —
 * does to the portrait. Quotes from it that it no longer holds go. A trait
 * the person never confirmed, left with nothing to rest on, goes too; so
 * does a rejected one (it was kept only so that note would not propose it
 * again). A confirmed or corrected trait stays: it is theirs now.
 */
export function afterNoteChange(traits: TraitLike[], noteId: string, newText: string | null): TraitChanges {
  const changes: TraitChanges = { update: [], remove: [] };
  for (const t of traits) {
    if (!t.evidence.some((e) => e.noteId === noteId)) continue;
    const evidence = t.evidence.filter((e) => e.noteId !== noteId || (newText !== null && quoteIn(e.quote, newText)));
    if (evidence.length === t.evidence.length) continue;
    const kept = t.status === "confirmed" || t.origin === "person";
    if (evidence.length === 0 && !kept) changes.remove.push(t.id);
    else changes.update.push({ id: t.id, evidence });
  }
  return changes;
}

/* ── Showing it ──────────────────────────────────────────────────── */

export interface PortraitTrait extends TraitLike {
  /** Quotes still true today, with the title of their note. */
  quotes: (Evidence & { title: string })[];
}

export type Portrait = Record<Dimension, PortraitTrait[]>;

/**
 * The portrait as shown: rejected traits hidden, quotes checked against the
 * notes as they are now — their own notes only, never one a model wrote —
 * confirmed first, then the best-supported, then the most recent. A
 * proposal whose quotes have all gone is not shown.
 */
export function portraitOf(traits: TraitLike[], notes: { id: string; title: string; detail?: string | null; ai?: boolean }[]): Portrait {
  const texts = new Map(notes.filter((n) => !n.ai).map((n) => [n.id, noteText(n)]));
  const titles = new Map(notes.map((n) => [n.id, n.title]));
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, [] as PortraitTrait[]])) as Portrait;
  for (const t of traits) {
    if (t.status === "rejected") continue;
    const quotes = liveEvidence(t.evidence, texts).map((e) => ({ ...e, title: titles.get(e.noteId) ?? "" }));
    if (quotes.length === 0 && t.status === "proposed" && t.origin === "ai") continue;
    out[t.dimension].push({ ...t, quotes });
  }
  const rank = (t: PortraitTrait) => (t.status === "confirmed" ? 0 : 1);
  for (const d of DIMENSIONS) {
    out[d].sort((a, b) => rank(a) - rank(b) || b.quotes.length - a.quotes.length || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  return out;
}

/** How much the double knows in each dimension: a confirmed trait counts one, a proposal half. */
export function coverage(traits: TraitLike[]): Record<Dimension, number> {
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;
  for (const t of traits) {
    if (t.status === "confirmed") out[t.dimension] += 1;
    else if (t.status === "proposed") out[t.dimension] += 0.5;
  }
  return out;
}

/**
 * The notes worth reading for the portrait, best first: those that say the
 * most about the person (thoughts, insights, goals, ideas, knowledge before
 * next steps), those not yet quoted, the most recent, the longest. At most
 * `limit`, and `only` restricts the choice (a note just written).
 *
 * Only their own words: a note a model wrote (`ai` — proposed steps, the
 * double's suggestions), even one they kept, is never read as evidence of
 * who they are.
 */
export function notesToRead<N extends { id: string; category: string; title: string; detail?: string | null; createdAt: string; done?: boolean; ai?: boolean }>(
  notes: N[],
  traits: TraitLike[],
  opts: { limit?: number; only?: string[] } = {}
): N[] {
  const { limit = 30, only } = opts;
  const quoted = new Set(traits.flatMap((t) => t.evidence.map((e) => e.noteId)));
  const weight: Record<string, number> = { thoughts: 5, insights: 5, goals: 4, ideas: 3, knowledge: 2, next: 1 };
  const pool = only ? notes.filter((n) => only.includes(n.id)) : notes;
  return pool
    .filter((n) => n.title.trim().length > 0 && !n.id.startsWith("temp-") && !n.ai)
    .map((n) => ({
      n,
      score:
        (weight[n.category] ?? 1) * 10 +
        (quoted.has(n.id) ? 0 : 25) +
        Math.min(10, noteText(n).length / 40) +
        (n.done ? -5 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.n.createdAt.localeCompare(a.n.createdAt) || a.n.id.localeCompare(b.n.id))
    .slice(0, limit)
    .map((x) => x.n);
}
