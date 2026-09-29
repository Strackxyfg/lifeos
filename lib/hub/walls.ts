/**
 * Walls with holes in them — how a building gets real windows.
 *
 * A glass front stuck on a solid block shows a reflection and nothing
 * behind it: to see the tables through a café's window, the wall must
 * actually be open there. A wall is a rectangle (along it `u`, up it `v`);
 * its openings are rectangles too. What stands is cut into as few solid
 * pieces as a grid allows: the edges of every opening split the wall into
 * cells, the open cells are dropped, and the rest are merged into runs —
 * row by row, then rows of identical runs stacked into one piece.
 *
 * Pure: the scene turns the pieces into boxes, the tests check that pieces
 * and openings tile the wall exactly, with no overlap and no gap.
 */

export interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const EPS = 1e-6;

function clampRect(r: Rect, length: number, height: number): Rect | null {
  const c = { u0: Math.max(0, r.u0), u1: Math.min(length, r.u1), v0: Math.max(0, r.v0), v1: Math.min(height, r.v1) };
  return c.u1 - c.u0 > EPS && c.v1 - c.v0 > EPS ? c : null;
}

function breaks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

/**
 * The solid pieces of a wall `length` long and `height` high, around its
 * `openings` (which may overlap one another or run past the wall's edge).
 */
export function wallPieces(length: number, height: number, openings: readonly Rect[]): Rect[] {
  const holes = openings.map((o) => clampRect(o, length, height)).filter((o): o is Rect => o !== null);
  if (!holes.length) return [{ u0: 0, u1: length, v0: 0, v1: height }];
  const us = breaks([0, length, ...holes.flatMap((h) => [h.u0, h.u1])]);
  const vs = breaks([0, height, ...holes.flatMap((h) => [h.v0, h.v1])]);
  const open = (u: number, v: number) => holes.some((h) => u > h.u0 && u < h.u1 && v > h.v0 && v < h.v1);

  // Row by row: the solid runs between the openings.
  const rows: { v0: number; v1: number; runs: [number, number][] }[] = [];
  for (let j = 0; j < vs.length - 1; j++) {
    const vm = (vs[j] + vs[j + 1]) / 2;
    const runs: [number, number][] = [];
    for (let i = 0; i < us.length - 1; i++) {
      if (open((us[i] + us[i + 1]) / 2, vm)) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last[1] - us[i]) < EPS) last[1] = us[i + 1];
      else runs.push([us[i], us[i + 1]]);
    }
    rows.push({ v0: vs[j], v1: vs[j + 1], runs });
  }

  // Stack identical runs of consecutive rows into single pieces.
  const pieces: Rect[] = [];
  const openRuns = new Map<string, Rect>();
  for (const row of rows) {
    const next = new Map<string, Rect>();
    for (const [u0, u1] of row.runs) {
      const key = `${u0.toFixed(6)}:${u1.toFixed(6)}`;
      const growing = openRuns.get(key);
      if (growing && Math.abs(growing.v1 - row.v0) < EPS) {
        growing.v1 = row.v1;
        next.set(key, growing);
      } else {
        const piece = { u0, u1, v0: row.v0, v1: row.v1 };
        pieces.push(piece);
        next.set(key, piece);
      }
    }
    openRuns.clear();
    for (const [k, p] of next) openRuns.set(k, p);
  }
  return pieces;
}

/** Area of a set of rectangles that do not overlap. */
export function area(rects: readonly Rect[]): number {
  return rects.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
}

/**
 * The area of the union of rectangles that may overlap (openings can),
 * by the same grid: exact, since every edge is a grid line.
 */
export function unionArea(rects: readonly Rect[]): number {
  if (!rects.length) return 0;
  const us = breaks(rects.flatMap((r) => [r.u0, r.u1]));
  const vs = breaks(rects.flatMap((r) => [r.v0, r.v1]));
  let s = 0;
  for (let i = 0; i < us.length - 1; i++) {
    for (let j = 0; j < vs.length - 1; j++) {
      const u = (us[i] + us[i + 1]) / 2;
      const v = (vs[j] + vs[j + 1]) / 2;
      if (rects.some((r) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1)) s += (us[i + 1] - us[i]) * (vs[j + 1] - vs[j]);
    }
  }
  return s;
}
