import { isCategory, type BrainCategoryId } from "@/lib/data/brain";
import { heuristicRegion } from "./classify";
import { normalize, tokens } from "./text";
import { isRelationKind, type RelationKind } from "./relations";

/**
 * A brain dump, split into atomic notes.
 *
 * Talking for two minutes on a walk, or pasting the notes of a meeting, gives
 * one long text. A second brain needs the opposite: one idea per note, each
 * filed where it belongs, the links between them kept. The model does the
 * splitting (`lib/ai/brain-ai.ts`); this module decides what of its answer
 * is kept. Pure, so it is tested without a model.
 */

export interface Atom {
  title: string;
  detail: string | null;
  region: BrainCategoryId;
  /** The words of the dump this note comes from: finds its passage in a recording. */
  said?: string;
}

export interface AtomRelation {
  /** Indices into the atoms. */
  a: number;
  b: number;
  kind: RelationKind;
  /** The atom the relation starts from, for directed kinds. */
  from: number | null;
  reason: string;
}

export interface AtomizeResult {
  atoms: Atom[];
  relations: AtomRelation[];
}

export const ATOMIZE_LIMITS = {
  /** Longer dumps are cut before they reach the model; the rest can be dumped again. */
  inputChars: 6_000,
  /** What the model is asked for. */
  atoms: 12,
  /** What one dump may add: the rule-based split can find more than the model returns. */
  saved: 20,
  title: 200,
  detail: 600,
  reason: 160,
} as const;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Directed relations are asked for with named roles — `{"kind":"supports",
 * "evidence":3,"claim":1}` — rather than "a" and "b". With bare letters the
 * model had to remember which end a relation starts from, and got it wrong
 * about one time in three on a real memo; with the role in the key, the
 * direction is what it writes. The first role is the source.
 */
export const RELATION_ROLES = {
  advances: ["step", "goal"],
  supports: ["evidence", "claim"],
  extends: ["development", "base"],
} as const satisfies Partial<Record<RelationKind, readonly [string, string]>>;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The first five letters of each meaningful word: "matinées" meets "matin", "travaille" meets "travail". */
const stems = (s: string) => new Set(tokens(s).map((t) => t.slice(0, 5)));
const flat = (s: string) => normalize(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** How far around a quote, within its sentence, the two notes must be named. */
const CONTEXT_CHARS = 200;

/**
 * Whether a relation between two atoms is one the person made — not one the
 * model inferred. The words it quotes must be in the dump (whole words;
 * fragments joined by "…" each found), and the sentences they come from must
 * say the link: one sentence names both notes, or two consecutive sentences
 * name one each and share a meaningful word ("I work better in the morning.
 * I should block my mornings.").
 *
 * Inferences are not lost, they are routed: once saved, the new notes go
 * through weaving, whose connections wait for the person's review. What is
 * saved from a dump as already accepted must be what the person said.
 *
 * On a real memo, without this, the model linked a call about a website quote
 * to a podcast launch "because the site is needed for the podcast", quoting two
 * neighbouring sentences that share no word — nobody had said it. A run-on
 * transcript with no full stops is bounded to 200 characters around the
 * quote, so one endless sentence cannot ground everything.
 */
export function grounded(said: string, source: string, a: string, b: string): boolean {
  const sentences = source.split(/(?<=[.!?\u2026])\s+|\n+/).map(flat).filter(Boolean);
  // The flattened dump, with where each sentence starts and ends in it.
  let hay = "";
  const spans: [number, number][] = [];
  for (const s of sentences) {
    if (hay) hay += " ";
    spans.push([hay.length, hay.length + s.length]);
    hay += s;
  }
  const fragments = said.split(/\.{3}|\u2026/).map(flat).filter(Boolean);
  if (fragments.length === 0 || fragments.join(" ").split(" ").length < 2) return false;

  /** Sentence index → the part of it near a quote. */
  const covered = new Map<number, string>();
  const padded = ` ${hay} `;
  for (const f of fragments) {
    let found = false;
    // The leading space of `padded` shifts every match by one: `i` is the index in `hay`.
    for (let i = padded.indexOf(` ${f} `); i !== -1; i = padded.indexOf(` ${f} `, i + 1)) {
      found = true;
      const to = i + f.length;
      spans.forEach(([s0, s1], k) => {
        // Only the sentences the quote itself runs through.
        if (!(i < s1 && to > s0)) return;
        const part = hay.slice(Math.max(s0, i - CONTEXT_CHARS), Math.min(s1, to + CONTEXT_CHARS));
        covered.set(k, `${covered.get(k) ?? ""} ${part}`);
      });
    }
    if (!found) return false;
  }

  const A = [...stems(a)];
  const B = [...stems(b)];
  const names = (set: Set<string>, note: string[]) => note.some((st) => set.has(st));
  const parts = [...covered.entries()].sort(([x], [y]) => x - y).map(([k, text]) => ({ k, set: stems(text) }));
  for (const p of parts) if (names(p.set, A) && names(p.set, B)) return true;
  for (let j = 1; j < parts.length; j++) {
    const [x, y] = [parts[j - 1], parts[j]];
    if (y.k !== x.k + 1) continue;
    const said = (names(x.set, A) && names(y.set, B)) || (names(x.set, B) && names(y.set, A));
    if (said && [...x.set].some((st) => y.set.has(st))) return true;
  }
  return false;
}

/**
 * What the model returned, validated. Atoms without a title are dropped,
 * repeats (ignoring case and accents) merged, regions checked, lengths
 * clipped; relations kept only between atoms that survived, of a known kind,
 * once per pair. Never throws.
 *
 * With the dump's text as `source`, two more checks: an atom that shares no
 * meaningful word with the dump is not from it, and a relation must be
 * `grounded` in a quote.
 */
export function sanitizeAtoms(raw: unknown, cap: number = ATOMIZE_LIMITS.atoms, source?: string): AtomizeResult {
  const sourceStems = source ? stems(source) : null;
  const data = (raw && typeof raw === "object" ? raw : {}) as { notes?: unknown; atoms?: unknown; relations?: unknown; links?: unknown };
  const list = Array.isArray(data.notes) ? data.notes : Array.isArray(data.atoms) ? data.atoms : [];

  const atoms: Atom[] = [];
  const seen = new Map<string, number>();
  /** Position in the model's list → position in `atoms`, or undefined if dropped. */
  const remap = new Map<number, number>();

  list.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? clip(oneLine(o.title), ATOMIZE_LIMITS.title) : "";
    if (title.length < 3) return;
    if (sourceStems) {
      const own = [...stems(title)];
      if (own.length > 0 && !own.some((s) => sourceStems.has(s))) return;
    }
    const key = normalize(title);
    const existing = seen.get(key);
    if (existing !== undefined) {
      remap.set(i, existing);
      return;
    }
    if (atoms.length === cap) return;
    const detailRaw = typeof o.detail === "string" ? o.detail.trim() : "";
    const regionRaw = typeof o.region === "string" ? o.region.toLowerCase().trim() : "";
    const saidRaw = typeof o.said === "string" ? oneLine(o.said) : "";
    atoms.push({
      title,
      detail: detailRaw ? clip(detailRaw, ATOMIZE_LIMITS.detail) : null,
      region: isCategory(regionRaw) ? regionRaw : "thoughts",
      ...(saidRaw ? { said: clip(saidRaw, 400) } : {}),
    });
    seen.set(key, atoms.length - 1);
    remap.set(i, atoms.length - 1);
  });

  const relList = Array.isArray(data.relations) ? data.relations : Array.isArray(data.links) ? data.links : [];
  const relations: AtomRelation[] = [];
  const pairs = new Set<string>();
  for (const item of relList) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    // The model numbers atoms from 1, as it was shown them.
    const toIndex = (v: unknown) => {
      const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
      return Number.isInteger(n) ? remap.get(n - 1) : undefined;
    };
    const kindRaw = typeof o.kind === "string" ? o.kind.toLowerCase().trim() : "";
    const kind: RelationKind = isRelationKind(kindRaw) ? kindRaw : "related";
    const roles = kind in RELATION_ROLES ? RELATION_ROLES[kind as keyof typeof RELATION_ROLES] : null;
    const pair = Array.isArray(o.notes) ? o.notes : null;
    const [rawA, rawB] =
      roles && o[roles[0]] !== undefined
        ? [o[roles[0]], o[roles[1]]]
        : pair
          ? [pair[0], pair[1]]
          : [o.a ?? o.from, o.b ?? o.to];
    const a = toIndex(rawA);
    const b = toIndex(rawB);
    if (a === undefined || b === undefined || a === b) continue;
    if (source !== undefined) {
      const said = typeof o.said === "string" ? o.said : "";
      if (!grounded(said, source, atoms[a].title, atoms[b].title)) continue;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    const reason = typeof o.reason === "string" ? clip(oneLine(o.reason), ATOMIZE_LIMITS.reason) : "";
    relations.push({
      a,
      b,
      kind,
      // "a" as the model gave it is where a directed relation starts.
      from: kind === "tension" || kind === "related" ? null : a,
      reason,
    });
  }
  return { atoms, relations };
}

const FR_WORDS = new Set(
  "le la les des est et je que qui pas pour une un du dans sur avec mais faut suis sont ce cette mon ma mes il elle on nous vous au aux".split(" ")
);
const EN_WORDS = new Set("the and is are to of that i we it for with but not this my be have was will a an on in at our you they".split(" "));

/**
 * The language a dump is written in, from its function words; null when it
 * is too short or too mixed to say. The model is told this explicitly: left
 * to itself, it followed the language of its own instructions' examples and
 * wrote an English meeting note back in French.
 */
export function dumpLanguage(text: string): "fr" | "en" | null {
  let fr = 0;
  let en = 0;
  for (const w of text.toLowerCase().split(/[^a-z\u00e0-\u00ff']+/)) {
    for (const part of w.split("'")) {
      if (FR_WORDS.has(part)) fr++;
      if (EN_WORDS.has(part)) en++;
    }
  }
  if (fr + en < 3) return null;
  if (fr >= 2 * en) return "fr";
  if (en >= 2 * fr) return "en";
  return null;
}

/** The dump as it is sent to the model: whitespace tidied, length bounded. */
export function prepareDump(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, ATOMIZE_LIMITS.inputChars);
}

const BULLET = /^(?:[-*\u2022\u00b7\u2013\u2014]|\d{1,2}[.)]|\[[ xX]?\])\s+/;
/** A sentence ends; the next one starts with a capital, a digit or a quote. */
const SENTENCE_END = /(?<=[.!?\u2026])\s+(?=[A-Z\u00c0-\u00dd0-9\u00ab"\u201c])/;

/**
 * The split without a model: one note per line or bullet, or per sentence
 * when the dump is a single paragraph. Used when no provider is configured,
 * when the model is resting, or when it fails — a dump is never refused.
 *
 * Nothing is dropped. A piece too long for a title keeps its full text as
 * the note's detail; past `saved` pieces, consecutive ones are grouped so the
 * last notes carry several lines rather than any line being lost.
 */
export function splitDump(text: string): AtomizeResult {
  const clean = prepareDump(text);
  if (!clean) return { atoms: [], relations: [] };

  let pieces = clean
    .split("\n")
    .map((l) => l.replace(BULLET, "").trim())
    .filter(Boolean);
  if (pieces.length === 1) pieces = pieces[0].split(SENTENCE_END).map((p) => p.trim()).filter(Boolean);

  const max = ATOMIZE_LIMITS.saved;
  const groups: string[][] = [];
  if (pieces.length <= max) pieces.forEach((p) => groups.push([p]));
  else {
    const size = Math.ceil(pieces.length / max);
    for (let i = 0; i < pieces.length; i += size) groups.push(pieces.slice(i, i + size));
  }

  const notes = groups.map((g) => {
    const [head, ...rest] = g;
    const long = head.length > ATOMIZE_LIMITS.title;
    const detail = [long ? head : "", ...rest].filter(Boolean).join("\n");
    return { title: head, detail, region: heuristicRegion(head) };
  });
  return sanitizeAtoms({ notes }, max);
}

/**
 * The atoms the person kept, with the relations between them renumbered.
 * A relation to an atom that was left out goes with it.
 */
export function keepAtoms(result: AtomizeResult, keep: readonly boolean[]): AtomizeResult {
  const index = new Map<number, number>();
  const atoms: Atom[] = [];
  result.atoms.forEach((atom, i) => {
    if (!keep[i]) return;
    index.set(i, atoms.length);
    atoms.push(atom);
  });
  const relations: AtomRelation[] = [];
  for (const r of result.relations) {
    const a = index.get(r.a);
    const b = index.get(r.b);
    if (a === undefined || b === undefined) continue;
    relations.push({ ...r, a, b, from: r.from === null ? null : index.get(r.from) ?? null });
  }
  return { atoms, relations };
}
