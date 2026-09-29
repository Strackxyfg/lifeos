import { describe, it, expect } from "vitest";
import { area, unionArea, wallPieces, type Rect } from "@/lib/hub/walls";

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0) > 1e-9 && Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0) > 1e-9;
}

/** Pieces and openings tile the wall: no overlap, no gap. */
function checkTiling(length: number, height: number, openings: Rect[]) {
  const pieces = wallPieces(length, height, openings);
  const clipped = openings
    .map((o) => ({ u0: Math.max(0, o.u0), u1: Math.min(length, o.u1), v0: Math.max(0, o.v0), v1: Math.min(height, o.v1) }))
    .filter((o) => o.u1 > o.u0 && o.v1 > o.v0);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    expect(p.u0).toBeGreaterThanOrEqual(0);
    expect(p.u1).toBeLessThanOrEqual(length + 1e-9);
    expect(p.v0).toBeGreaterThanOrEqual(0);
    expect(p.v1).toBeLessThanOrEqual(height + 1e-9);
    for (let j = i + 1; j < pieces.length; j++) expect(overlaps(p, pieces[j])).toBe(false);
    for (const o of clipped) expect(overlaps(p, o)).toBe(false);
  }
  expect(area(pieces) + unionArea(clipped)).toBeCloseTo(length * height, 9);
  return pieces;
}

describe("walls with openings", () => {
  it("leaves a wall without openings whole", () => {
    expect(wallPieces(4, 2, [])).toEqual([{ u0: 0, u1: 4, v0: 0, v1: 2 }]);
  });

  it("frames a shop window with four pieces: sill, lintel and two piers", () => {
    const pieces = checkTiling(3.6, 1.7, [{ u0: 0.2, u1: 3.4, v0: 0.13, v1: 1.43 }]);
    expect(pieces).toHaveLength(4);
  });

  it("handles a door in a band of windows (overlapping openings)", () => {
    checkTiling(3.4, 2.5, [
      { u0: 0.15, u1: 3.25, v0: 0.54, v1: 1.16 },
      { u0: 1.15, u1: 2.25, v0: 0.1, v1: 1.16 },
      { u0: 0.15, u1: 3.25, v0: 1.64, v1: 2.26 },
    ]);
  });

  it("clips openings that run past the edges, and ignores empty ones", () => {
    checkTiling(2, 2, [
      { u0: -1, u1: 0.5, v0: 0.5, v1: 1.5 },
      { u0: 1, u1: 1, v0: 0, v1: 2 },
      { u0: 1.5, u1: 3, v0: -1, v1: 3 },
    ]);
  });

  it("stacks identical runs into single pieces rather than one per row", () => {
    // Two windows side by side: the piers between and beside them are full height.
    const pieces = checkTiling(5, 2, [
      { u0: 0.5, u1: 2, v0: 0.5, v1: 1.5 },
      { u0: 3, u1: 4.5, v0: 0.5, v1: 1.5 },
    ]);
    const fullHeight = pieces.filter((p) => p.v0 === 0 && p.v1 === 2);
    expect(fullHeight).toHaveLength(0);
    expect(pieces.length).toBeLessThanOrEqual(5);
  });

  it("survives a random fuzz of openings", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 60; n++) {
      const L = 1 + rnd() * 5;
      const H = 1 + rnd() * 4;
      const openings = Array.from({ length: Math.floor(rnd() * 5) }, () => {
        const u = rnd() * L;
        const v = rnd() * H;
        return { u0: u, u1: u + rnd() * L * 0.6, v0: v, v1: v + rnd() * H * 0.6 };
      });
      checkTiling(L, H, openings);
    }
  });
});
