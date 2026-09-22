import { hash, normalize } from "./text";

/**
 * What a note is about, beyond the words it happens to use.
 *
 * Word overlap alone misses most real connections: "Relancer Marc pour le
 * pilote" and "Signer 10 clients" share no word, "parrainage" never meets
 * "referral", and a note written in English is invisible from one written in
 * French. Concepts close that gap. The model reads each note once and names
 * what it is about; each concept carries
 *
 *   k — a canonical key in English, lowercase, singular: what matching uses;
 *   l — the same concept in the note's own language: what people are shown.
 *
 * Pure: extraction happens elsewhere (`lib/ai/brain-ai.ts`); this module only
 * validates, compares and aggregates.
 */
export interface Concept {
  k: string;
  l: string;
}

export const MAX_CONCEPTS = 6;

/**
 * Keys too broad to connect anything. Two notes both "about business" are not
 * related in any way a person would care about. Checked after normalisation.
 */
const GENERIC = new Set([
  "idea", "note", "thought", "task", "todo", "to do", "goal", "objective", "plan", "project", "work",
  "business", "life", "personal", "thing", "stuff", "action", "next step", "step", "question",
  "reminder", "insight", "knowledge", "misc", "general", "other", "important", "priority",
]);

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).trimEnd());

/** "Referral  Programs!" → "referral programs". Letters, digits, spaces, hyphens, apostrophes. */
function cleanKey(raw: string): string {
  return normalize(raw)
    .replace(/[^a-z0-9' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLabel(raw: string): string {
  return clip(raw.replace(/\s+/g, " ").trim(), 48);
}

/**
 * Validated concepts from whatever the model returned. Accepts `{k, l}` objects
 * or bare strings; drops generic, empty, numeric and over-long keys; keeps the
 * first occurrence of each key; caps the count. Never throws.
 */
export function sanitizeConcepts(raw: unknown): Concept[] {
  if (!Array.isArray(raw)) return [];
  const out: Concept[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let k = "";
    let l = "";
    if (typeof item === "string") {
      k = item;
      l = item;
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      k = typeof o.k === "string" ? o.k : typeof o.key === "string" ? o.key : "";
      l = typeof o.l === "string" ? o.l : typeof o.label === "string" ? o.label : k;
    }
    const key = cleanKey(k);
    if (key.length < 2 || key.length > 40 || key.split(" ").length > 4) continue;
    if (/^[\d\s'-]+$/.test(key) || GENERIC.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ k: key, l: cleanLabel(l) || key });
    if (out.length === MAX_CONCEPTS) break;
  }
  return out;
}

/**
 * Fingerprint of the text concepts were extracted from. Whitespace and case
 * do not count as a change; any word does. Stored next to the concepts, so an
 * edited note is analysed again and an unchanged one never is.
 */
export function contentHash(title: string, detail?: string | null): string {
  const text = normalize(`${title}\n${detail ?? ""}`).replace(/\s+/g, " ").trim();
  return hash(text).toString(36);
}

export interface WithConcepts {
  id: string;
  concepts?: Concept[];
}

const KEY_STOP = new Set(["of", "and", "the", "for", "with", "per", "to", "in", "on", "a", "an", "by", "at", "or"]);

/**
 * The terms a note's concepts are compared on: each whole key, plus each
 * meaningful word of a multi-word key. Whole keys alone are too literal —
 * "running schedule" never met "running", so a training plan never met the
 * marathon it prepares. Words alone would be too loose; together, a shared
 * whole key weighs more than a shared word, as it should.
 */
export function conceptTerms(concepts: Concept[] | undefined): string[] {
  const out = new Set<string>();
  for (const c of concepts ?? []) {
    out.add(c.k);
    const parts = c.k.split(" ");
    if (parts.length > 1) for (const w of parts) if (w.length >= 3 && !KEY_STOP.has(w)) out.add(w);
  }
  return [...out];
}

/** Inverse document frequency of each concept term across the person's notes. */
export function conceptIdf(notes: WithConcepts[]): (term: string) => number {
  const df = new Map<string, number>();
  for (const n of notes) for (const t of conceptTerms(n.concepts)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = notes.length;
  return (term) => Math.log((N + 1) / ((df.get(term) ?? 0) + 1)) + 1;
}

/**
 * Weighted Ochiai overlap of two notes' concept terms, with the concepts that
 * carry the shared terms (labelled as in the first note — the one being
 * looked at), most distinctive first.
 */
export function conceptOverlap(
  a: Concept[] | undefined,
  b: Concept[] | undefined,
  idf: (term: string) => number
): { score: number; shared: Concept[] } {
  if (!a?.length || !b?.length) return { score: 0, shared: [] };
  const ta = conceptTerms(a);
  const tb = conceptTerms(b);
  const inB = new Set(tb);
  const shared = ta.filter((t) => inB.has(t));
  if (shared.length === 0) return { score: 0, shared: [] };

  const w = (ts: string[]) => ts.reduce((s, t) => s + idf(t), 0);
  const score = w(shared) / Math.sqrt(w(ta) * w(tb));

  // Which of the first note's concepts carry a shared term, ordered by the
  // rarest term each carries.
  const strength = (c: Concept) =>
    Math.max(0, ...shared.filter((t) => t === c.k || c.k.split(" ").includes(t)).map(idf));
  const carriers = a
    .filter((c) => strength(c) > 0)
    .sort((x, y) => strength(y) - strength(x) || x.k.localeCompare(y.k));
  return { score, shared: carriers };
}

export interface Theme {
  key: string;
  /** The label people used most often for it. */
  label: string;
  noteIds: string[];
}

/**
 * The subjects the person keeps coming back to: concepts shared by at least
 * `min` open notes, most frequent first. A second brain should show you what
 * you think about — not only store it.
 */
export function themes(
  notes: (WithConcepts & { done: boolean })[],
  { min = 2, limit = 8 }: { min?: number; limit?: number } = {}
): Theme[] {
  const byKey = new Map<string, { ids: string[]; labels: Map<string, number> }>();
  for (const n of notes) {
    if (n.done) continue;
    for (const c of n.concepts ?? []) {
      const entry = byKey.get(c.k) ?? { ids: [], labels: new Map<string, number>() };
      if (!entry.ids.includes(n.id)) entry.ids.push(n.id);
      entry.labels.set(c.l, (entry.labels.get(c.l) ?? 0) + 1);
      byKey.set(c.k, entry);
    }
  }
  const out: Theme[] = [];
  for (const [key, { ids, labels }] of byKey) {
    if (ids.length < min) continue;
    const label = [...labels.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
    out.push({ key, label, noteIds: ids });
  }
  return out
    .sort((a, b) => b.noteIds.length - a.noteIds.length || a.label.localeCompare(b.label))
    .slice(0, limit);
}
