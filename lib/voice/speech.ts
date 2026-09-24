/**
 * Speech output, the parts that can be tested without a speaker.
 *
 * Answers are written for the eye — bullets, bold, quoted titles, links — and
 * read by a speech engine that pronounces "astérisque astérisque" and spells
 * out URLs. `toSpeakable` turns text into what should be heard. `SentenceStream`
 * cuts a streaming answer into sentences as they complete, so the voice can
 * start on the first one instead of waiting for the whole answer, and never
 * hands the engine a paragraph long enough to trip Chrome's cut-off (it stops
 * speaking an utterance after about fifteen seconds). `rankVoices` picks the
 * best voice the device has for a language.
 */

const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]+/gi;

/** Text as it should be heard. */
export function toSpeakable(text: string): string {
  const lines = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(URL_RE, " ")
    .replace(PICTOGRAPHS, "")
    .split(/\r?\n/);

  const out: string[] = [];
  for (const raw of lines) {
    let line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*\u2022\u00b7]|\d{1,2}[.)])\s+/, "")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_](\S[^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/\s*(?:->|\u2192|=>)\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    if (!line || !/[\p{L}\p{N}]/u.test(line)) continue;
    // A bullet or a heading is a sentence to the ear: give it its pause.
    if (!/[.!?\u2026:;,]$/.test(line)) line += ".";
    out.push(line);
  }
  return out.join(" ");
}

/** Abbreviations whose full stop does not end a sentence. Lowercased, without the dot. */
const ABBREVIATIONS = new Set([
  "m", "mm", "mme", "mmes", "mlle", "dr", "pr", "st", "ste", "etc", "ex", "p", "cf", "vs", "env", "av", "apr", "j.-c",
  "mr", "mrs", "ms", "prof", "sr", "jr", "e.g", "i.e", "approx", "no", "vol", "fig",
]);

/** Past this, a sentence is cut at a comma or a semicolon: the engine would stop mid-way. */
export const MAX_SPOKEN = 220;

function endsSentence(buffer: string, at: number): boolean {
  const mark = buffer[at];
  if (mark !== ".") return true;
  // "3.5", "lifeos.ai": no space after the dot, handled by the caller. Here,
  // the word before the dot decides.
  const before = buffer.slice(0, at).match(/([\p{L}.-]+)$/u)?.[1]?.toLowerCase() ?? "";
  if (ABBREVIATIONS.has(before)) return false;
  // A single capital letter: an initial ("J. Dupont").
  if (/^\p{Lu}$/u.test(buffer.slice(0, at).match(/(\p{L}+)$/u)?.[1] ?? "")) return false;
  return true;
}

function cutLong(sentence: string): string[] {
  if (sentence.length <= MAX_SPOKEN) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SPOKEN) {
    const window = rest.slice(0, MAX_SPOKEN);
    const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" \u2014 "));
    const cut = at > 60 ? at + 1 : window.lastIndexOf(" ") > 60 ? window.lastIndexOf(" ") : MAX_SPOKEN;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Sentences out of a text that arrives in pieces. `push` returns the
 * sentences completed by the new piece; `flush` returns what is left once the
 * text is complete. Each sentence is already speakable.
 */
export class SentenceStream {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      const next = this.buffer[i + 1];
      // A paragraph or a list item ends where its line ends.
      const lineEnd = c === "\n";
      const mark = (c === "." || c === "!" || c === "?" || c === "\u2026") && next !== undefined && /\s/.test(next);
      if (!lineEnd && !(mark && endsSentence(this.buffer, i))) continue;
      const piece = this.buffer.slice(start, i + 1);
      start = i + 1;
      const spoken = toSpeakable(piece);
      if (spoken) out.push(...cutLong(spoken));
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  flush(): string[] {
    const spoken = toSpeakable(this.buffer);
    this.buffer = "";
    return spoken ? cutLong(spoken) : [];
  }
}

/** All the sentences of a finished text. */
export function sentencesOf(text: string): string[] {
  const s = new SentenceStream();
  return [...s.push(`${text}\n`), ...s.flush()];
}

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default?: boolean;
}

/** How good a voice sounds, from what its name says. Natural and neural voices are recorded, not assembled. */
export function voiceQuality(v: VoiceLike): number {
  const n = v.name.toLowerCase();
  if (/natural|neural|premium|enhanced|siri/.test(n)) return 3;
  if (/google/.test(n)) return 2;
  if (/compact|espeak|robot/.test(n)) return 0;
  return 1;
}

/**
 * The device's voices for a language, best first. `online` voices send the
 * text they read to the browser's speech service (Google in Chrome, Microsoft
 * in Edge); they are left out unless allowed — what an answer says about a
 * person's notes should not leave the device just to be read aloud.
 */
export function rankVoices(voices: VoiceLike[], lang: "fr" | "en", allowOnline: boolean): VoiceLike[] {
  const preferred = lang === "fr" ? "fr-fr" : "en-us";
  return voices
    .filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang))
    .filter((v) => allowOnline || v.localService)
    .map((v) => {
      const region = v.lang.toLowerCase().replace("_", "-") === preferred ? 1 : lang === "en" && /en-gb/i.test(v.lang) ? 0.6 : 0;
      return { v, score: voiceQuality(v) * 10 + region * 3 + (v.default ? 0.5 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v);
}
