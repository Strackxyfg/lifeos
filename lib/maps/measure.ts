/**
 * Text, measured and broken into lines once — the same lines everywhere:
 * the editor, the SVG export and the PNG export draw exactly what the
 * layout measured, so nothing overflows its box in one and not the other.
 *
 * The width function is injected: the page measures with a canvas in the
 * loaded font; tests (and anything without a canvas) use an approximation.
 */

export interface Measurer {
  /** Width in pixels of `text` drawn in the CSS `font` (e.g. `600 16px Geist`). */
  width(text: string, font: string): number;
}

export const fontString = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

/** Roughly what a proportional font takes: for tests and anything without a canvas. */
export function approxMeasurer(factor = 0.56): Measurer {
  return {
    width(text, font) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 14);
      let w = 0;
      for (const ch of text) w += ch === " " ? 0.32 : /[A-Z]/.test(ch) ? 0.68 : /[ilj.,;:'!|]/.test(ch) ? 0.3 : /\p{Extended_Pictographic}/u.test(ch) ? 1.2 : factor;
      return w * size;
    },
  };
}

/** A canvas measurer with a cache: the same label is measured once per font. */
export function canvasMeasurer(): Measurer {
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  const cache = new Map<string, number>();
  let current = "";
  return {
    width(text, font) {
      const key = `${font}\u0001${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      if (!ctx) return approxMeasurer().width(text, font);
      if (font !== current) {
        ctx.font = font;
        current = font;
      }
      const w = ctx.measureText(text).width;
      if (cache.size > 20_000) cache.clear();
      cache.set(key, w);
      return w;
    },
  };
}

/** Graphemes, so an emoji or an accented letter is never cut in two. */
function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].map((p) => p.segment) : Array.from(s);
}

/**
 * The lines `text` takes at `maxWidth`: breaks at spaces, keeps the line
 * breaks typed, and cuts a word longer than a line between two characters.
 * An empty text is one empty line.
 */
export function wrap(text: string, font: string, maxWidth: number, m: Measurer): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/ +/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (m.width(candidate, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = "";
      if (m.width(word, font) <= maxWidth) {
        line = word;
        continue;
      }
      // A word wider than the line: cut it, grapheme by grapheme.
      let piece = "";
      for (const g of graphemes(word)) {
        if (piece && m.width(piece + g, font) > maxWidth) {
          out.push(piece);
          piece = g;
        } else piece += g;
      }
      line = piece;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}
