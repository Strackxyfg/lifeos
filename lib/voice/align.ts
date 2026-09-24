/**
 * Where, in a recording, something was said.
 *
 * Whisper returns every word with its start and end time. When a memo is
 * split into notes, the model quotes, for each note, the words it comes from
 * (`said`); this finds those words in the recording, so each note can play
 * back the exact passage — "listen to where I said this".
 *
 * The quote is never exactly the recording: the model drops "euh", mends a
 * false start, normalises punctuation. So the match is a local alignment
 * (Smith–Waterman) over normalised words: matches score, a skipped word in
 * either sequence costs a little, and the best-scoring stretch wins. A quote
 * is placed only if most of its words were found; a paraphrase is not placed.
 * Pure, and bounded: a five-minute memo is under a thousand words.
 */

export interface AudioWord {
  /** The word as transcribed, punctuation included. */
  w: string;
  /** Start and end, in milliseconds from the beginning of the recording. */
  s: number;
  e: number;
}

export interface Passage {
  start: number;
  end: number;
  /** Share of the quote's words found in order in the recording. */
  coverage: number;
}

/** Of a quote's words, how many must be found for it to be placed. */
export const MIN_COVERAGE = 0.6;

export function normWord(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const tokens = (text: string) => text.split(/\s+/).map(normWord).filter(Boolean);

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

export function locateQuote(words: AudioWord[], quote: string): Passage | null {
  const q = tokens(quote);
  if (q.length === 0 || words.length === 0) return null;
  const w = words.map((x) => normWord(x.w));
  const n = w.length;
  const m = q.length;
  const width = m + 1;
  const H = new Float64Array((n + 1) * width);
  // 0 stop, 1 diagonal, 2 up (skip a recorded word), 3 left (skip a quote word)
  const from = new Uint8Array((n + 1) * width);
  let best = 0;
  let bi = 0;
  let bj = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = H[(i - 1) * width + (j - 1)] + (w[i - 1] === q[j - 1] ? MATCH : MISMATCH);
      const up = H[(i - 1) * width + j] + GAP;
      const left = H[i * width + (j - 1)] + GAP;
      let v = 0;
      let d = 0;
      if (diag > v) (v = diag), (d = 1);
      if (up > v) (v = up), (d = 2);
      if (left > v) (v = left), (d = 3);
      H[i * width + j] = v;
      from[i * width + j] = d;
      if (v > best) (best = v), (bi = i), (bj = j);
    }
  }
  if (best <= 0) return null;

  // Walk back along the best path, counting the words actually matched.
  let i = bi;
  let j = bj;
  let matched = 0;
  let firstWord = bi - 1;
  while (i > 0 && j > 0 && from[i * width + j] !== 0) {
    const d = from[i * width + j];
    if (d === 1) {
      if (w[i - 1] === q[j - 1]) matched += 1;
      firstWord = i - 1;
      i -= 1;
      j -= 1;
    } else if (d === 2) {
      firstWord = i - 1;
      i -= 1;
    } else {
      j -= 1;
    }
  }
  const coverage = matched / m;
  if (coverage < MIN_COVERAGE || matched < Math.min(2, m)) return null;
  return { start: words[firstWord].s, end: words[bi - 1].e, coverage: Math.round(coverage * 100) / 100 };
}

/** The words of a recording between two times — what a passage says. */
export function wordsIn(words: AudioWord[], start: number, end: number): AudioWord[] {
  return words.filter((x) => x.e > start && x.s < end);
}

/** A transcript's words as received from Whisper (seconds), made safe and in milliseconds. */
export function toAudioWords(raw: unknown, maxWords = 4_000): AudioWord[] {
  if (!Array.isArray(raw)) return [];
  const out: AudioWord[] = [];
  for (const item of raw.slice(0, maxWords)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const w = typeof o.word === "string" ? o.word : typeof o.w === "string" ? o.w : "";
    const s = typeof o.start === "number" ? Math.round(o.start * 1000) : typeof o.s === "number" ? Math.round(o.s) : NaN;
    const e = typeof o.end === "number" ? Math.round(o.end * 1000) : typeof o.e === "number" ? Math.round(o.e) : NaN;
    const word = w.trim().slice(0, 60);
    if (!word || !Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) continue;
    out.push({ w: word, s, e });
  }
  return out.sort((a, b) => a.s - b.s);
}
