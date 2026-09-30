import { DISTRICTS, facing, type District } from "./districts";

/**
 * The island's ground plan: its coastline, the plaza, the harbour, the paths
 * to every door, where lamps, trees and benches stand.
 *
 * Pure and deterministic — the same island on every screen, every visit, and
 * the tests can check it (every building on land, none in another, every
 * path reaching a door).
 */

export type Point = readonly [number, number];

/** Control points of the main coastline (x, z), clockwise seen from above. */
const MAIN_CONTROL: readonly Point[] = [
  [0, -12.9],
  [5.2, -12.3],
  [10.2, -9.6],
  [12.9, -5.4],
  [14.9, -1.2],
  [14.6, 3.2],
  [12.4, 6.6],
  [10.6, 9.6],
  [6.8, 10.8],
  [3.6, 9.4],
  [1.5, 7.9],
  [-1.5, 7.9],
  [-3.6, 9.4],
  [-6.6, 11.2],
  [-10.8, 10.2],
  [-13.4, 6.6],
  [-14.9, 2.2],
  [-14.6, -2.6],
  [-12.8, -7.0],
  [-9.8, -10.6],
  [-5.2, -12.4],
];

/** The rock the lighthouse stands on. */
const ISLET_CENTER: Point = [13.4, 11.4];
const ISLET_RADIUS = 1.75;

export const PLAZA = { center: [0, 1.6] as Point, radius: 5.2 };
export const FOUNTAIN = { center: [0, 1.6] as Point, radius: 1.35 };

/** The jetty into the harbour, from the plaza's edge out over the water. */
export const DOCK = { from: [0, 7.4] as Point, to: [0, 13.6] as Point, width: 1.3 };

/** A narrow causeway to the lighthouse. */
export const CAUSEWAY = { from: [10.9, 8.9] as Point, to: [12.7, 10.6] as Point, width: 0.9 };

/**
 * Centripetal Catmull–Rom through closed control points: smooth, and unlike
 * the uniform kind it never loops or overshoots at tight corners.
 */
export function smoothClosed(points: readonly Point[], perSegment = 10): Point[] {
  const n = points.length;
  const out: Point[] = [];
  const at = (i: number) => points[(i + n) % n];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const dt = (a: Point, b: Point) => Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t0 = 0, t1 = t0 + dt(p0, p1), t2 = t1 + dt(p1, p2), t3 = t2 + dt(p2, p3);
    for (let s = 0; s < perSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / perSegment;
      const lerp = (a: Point, b: Point, ta: number, tb: number): Point => {
        const k = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      };
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

export const MAIN_OUTLINE: readonly Point[] = smoothClosed(MAIN_CONTROL, 10);

export const ISLET_OUTLINE: readonly Point[] = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  // A little irregular: a rock, not a coin.
  const r = ISLET_RADIUS * (1 + 0.08 * Math.sin(a * 3 + 0.7) + 0.05 * Math.cos(a * 5));
  return [ISLET_CENTER[0] + Math.cos(a) * r, ISLET_CENTER[1] + Math.sin(a) * r] as Point;
});

export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}

/** Distance to the polygon's edge (positive inside and outside alike). */
export function edgeDistance(p: Point, poly: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, segmentDistance(p, poly[j], poly[i]));
  return best;
}

/** Whether a point is on land: the island, the lighthouse rock, the causeway or the jetty. */
export function onLand(p: Point): boolean {
  return (
    pointInPolygon(p, MAIN_OUTLINE) ||
    pointInPolygon(p, ISLET_OUTLINE) ||
    segmentDistance(p, CAUSEWAY.from, CAUSEWAY.to) <= CAUSEWAY.width / 2 ||
    segmentDistance(p, DOCK.from, DOCK.to) <= DOCK.width / 2
  );
}

/**
 * How close to the shore each point of the water is, as bytes: 255 on land,
 * falling to 0 at `reach` units out to sea. The water shader turns it into
 * shallows, a foam line, and the deep blue beyond. Row-major, `size`²,
 * covering [-extent, extent] on both axes; row 0 is z = −extent.
 *
 * The same bytes as asking `pointInPolygon` and `edgeDistance` at every
 * point (the tests compare the two), in a fraction of the time — it was
 * the heaviest work of the island's first second:
 * - inside or out, by scanline: a row's edge crossings are computed once,
 *   with the very expression `pointInPolygon` uses, and each point counts
 *   those to its right;
 * - the distance, from the segments near the point only: they are sorted
 *   into square cells, searched ring by ring outwards from the point's own;
 *   once the rings searched reach k cells, any segment not yet seen is at
 *   least (k − 1) cells away — the search stops when that is no closer
 *   than the best found, or than `reach` (beyond which every distance
 *   gives 0).
 */
export function shoreField(size: number, extent: number, reach: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * size);
  const polys = [MAIN_OUTLINE, ISLET_OUTLINE];
  // Most of the square is open sea: skip the distance work outside the
  // coastline's bounding box widened by the reach.
  const all = polys.flat();
  const minX = Math.min(...all.map((p) => p[0])) - reach;
  const maxX = Math.max(...all.map((p) => p[0])) + reach;
  const minZ = Math.min(...all.map((p) => p[1])) - reach;
  const maxZ = Math.max(...all.map((p) => p[1])) + reach;

  const segments: [Point, Point][] = [];
  for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) segments.push([poly[j], poly[i]]);
  // A few segments to a cell: the coast is sampled every half unit or so.
  const cell = Math.max(reach / 4, 1e-3);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const cellOf = (v: number, min: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((v - min) / cell)));
  const grid: number[][] = Array.from({ length: cols * rows }, () => []);
  segments.forEach(([a, b], k) => {
    const c0 = cellOf(Math.min(a[0], b[0]), minX, cols), c1 = cellOf(Math.max(a[0], b[0]), minX, cols);
    const r0 = cellOf(Math.min(a[1], b[1]), minZ, rows), r1 = cellOf(Math.max(a[1], b[1]), minZ, rows);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * cols + c].push(k);
  });
  const seen = new Int32Array(segments.length).fill(-1);
  let stamp = 0;

  for (let row = 0; row < size; row++) {
    const z = -extent + ((row + 0.5) / size) * extent * 2;
    if (z < minZ || z > maxZ) continue;
    // Each polygon's crossings of this row, as `pointInPolygon` computes them.
    const crossings = polys.map((poly) => {
      const xs: number[] = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > z !== zj > z) xs.push(((xj - xi) * (z - zi)) / (zj - zi) + xi);
      }
      return xs.sort((a, b) => a - b);
    });
    const passed = crossings.map(() => 0);
    const r = cellOf(z, minZ, rows);
    for (let col = 0; col < size; col++) {
      const x = -extent + ((col + 0.5) / size) * extent * 2;
      if (x < minX || x > maxX) continue;
      let land = false;
      for (let k = 0; k < crossings.length; k++) {
        const xs = crossings[k];
        // Crossings at or left of x no longer count; those to its right flip the parity.
        while (passed[k] < xs.length && !(x < xs[passed[k]])) passed[k]++;
        if ((xs.length - passed[k]) % 2 === 1) land = true;
      }
      let v: number;
      if (land) v = 1;
      else {
        const c = cellOf(x, minX, cols);
        const p: Point = [x, z];
        let d = Infinity;
        stamp++;
        const rings = Math.max(r, rows - 1 - r, c, cols - 1 - c);
        for (let ring = 0; ring <= rings; ring++) {
          // Everything unseen now lies beyond ring − 1 whole cells.
          const beyond = Math.max(0, ring - 1) * cell;
          if (d <= beyond || beyond >= reach) break;
          for (let rr = r - ring; rr <= r + ring; rr++) {
            if (rr < 0 || rr >= rows) continue;
            const edge = rr === r - ring || rr === r + ring;
            for (let cc = c - ring; cc <= c + ring; cc += edge ? 1 : 2 * ring) {
              if (cc < 0 || cc >= cols) continue;
              for (const k of grid[rr * cols + cc]) {
                if (seen[k] === stamp) continue;
                seen[k] = stamp;
                d = Math.min(d, segmentDistance(p, segments[k][0], segments[k][1]));
              }
            }
          }
        }
        v = Math.max(0, 1 - d / reach);
      }
      out[row * size + col] = Math.round(v * 255);
    }
  }
  return out;
}

/* ── What stands on it ───────────────────────────────────────────── */

/** Where a building's door is, on its footprint. */
export function doorOf(d: Pick<District, "id" | "at" | "radius">): Point {
  const f = facing(d);
  return [d.at[0] + Math.sin(f) * d.radius, d.at[1] + Math.cos(f) * d.radius];
}

export interface PathSegment {
  from: Point;
  to: Point;
  width: number;
}

/** From the plaza's rim to each door. The lighthouse is reached by the causeway. */
export const PATHS: readonly PathSegment[] = DISTRICTS.filter((d) => d.id !== "settings" && d.id !== "today").map((d) => {
  const door = doorOf(d);
  const dx = door[0] - PLAZA.center[0];
  const dz = door[1] - PLAZA.center[1];
  const len = Math.hypot(dx, dz);
  const rim: Point = [PLAZA.center[0] + (dx / len) * (PLAZA.radius - 0.2), PLAZA.center[1] + (dz / len) * (PLAZA.radius - 0.2)];
  return { from: rim, to: door, width: 1.25 };
});

/** A small deterministic generator: the same trees in the same places, always. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lamps around the plaza, leaving the mouths of the paths clear. */
export const PLAZA_LAMPS: readonly Point[] = (() => {
  const mouths = PATHS.map((p) => Math.atan2(p.from[1] - PLAZA.center[1], p.from[0] - PLAZA.center[0]));
  mouths.push(Math.atan2(DOCK.from[1] - PLAZA.center[1], DOCK.from[0] - PLAZA.center[0]));
  const out: Point[] = [];
  const count = 14;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.11;
    const clear = mouths.every((m) => Math.abs(Math.atan2(Math.sin(a - m), Math.cos(a - m))) > 0.22);
    if (clear) out.push([PLAZA.center[0] + Math.cos(a) * (PLAZA.radius + 0.35), PLAZA.center[1] + Math.sin(a) * (PLAZA.radius + 0.35)]);
  }
  return out;
})();

/** Lamps along the jetty and the causeway. */
export const WATERFRONT_LAMPS: readonly Point[] = [
  [-0.5, 9.2], [0.5, 11.2], [-0.5, 13.2],
  [11.3, 9.4], [12.3, 10.4],
];

/** Lawns between the buildings: (centre, radius). */
export const LAWNS: readonly { at: Point; r: number; seed: number }[] = [
  { at: [-4.4, -7.4], r: 1.9, seed: 1 },
  { at: [4.4, -7.6], r: 2.0, seed: 2 },
  { at: [11.9, -4.2], r: 1.5, seed: 3 },
  { at: [-12.2, -3.9], r: 1.5, seed: 4 },
  { at: [-11.2, 5.8], r: 1.7, seed: 5 },
  { at: [11.4, 4.6], r: 1.6, seed: 6 },
  { at: [-3.9, 6.6], r: 1.3, seed: 7 },
  { at: [3.9, 6.6], r: 1.3, seed: 8 },
  { at: [7.4, -1.2], r: 1.6, seed: 9 },
  { at: [-7.2, -0.6], r: 1.4, seed: 10 },
];

export interface Tree {
  at: Point;
  /** Round crown or a cypress. */
  kind: "round" | "cypress";
  scale: number;
}

/** Trees on the lawns and along the coast, never on a path or in a building. */
export const TREES: readonly Tree[] = (() => {
  const rnd = seeded(7);
  const out: Tree[] = [];
  const clearOfBuildings = (p: Point, margin: number) =>
    DISTRICTS.every((d) => Math.hypot(p[0] - d.at[0], p[1] - d.at[1]) > d.radius + margin);
  const clearOfPaths = (p: Point) => PATHS.every((s) => segmentDistance(p, s.from, s.to) > s.width / 2 + 0.45);
  const clearOfPlaza = (p: Point) => Math.hypot(p[0] - PLAZA.center[0], p[1] - PLAZA.center[1]) > PLAZA.radius + 0.8;
  const accept = (p: Point) =>
    pointInPolygon(p, MAIN_OUTLINE) &&
    edgeDistance(p, MAIN_OUTLINE) > 0.7 &&
    clearOfBuildings(p, 0.9) &&
    clearOfPaths(p) &&
    clearOfPlaza(p) &&
    segmentDistance(p, DOCK.from, DOCK.to) > 1.4 &&
    out.every((t) => Math.hypot(t.at[0] - p[0], t.at[1] - p[1]) > 1.05);

  for (const lawn of LAWNS) {
    for (let k = 0; k < 14 && out.filter((t) => Math.hypot(t.at[0] - lawn.at[0], t.at[1] - lawn.at[1]) < lawn.r).length < 3; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * lawn.r * 0.75;
      const p: Point = [lawn.at[0] + Math.cos(a) * r, lawn.at[1] + Math.sin(a) * r];
      if (accept(p)) out.push({ at: p, kind: rnd() < 0.3 ? "cypress" : "round", scale: 0.62 + rnd() * 0.36 });
    }
  }
  // Along the coast.
  for (let i = 0; i < MAIN_OUTLINE.length; i += 5) {
    const [x, z] = MAIN_OUTLINE[i];
    const len = Math.hypot(x, z) || 1;
    const p: Point = [x - (x / len) * 1.3, z - (z / len) * 1.3];
    if (rnd() < 0.55 && accept(p)) out.push({ at: p, kind: rnd() < 0.4 ? "cypress" : "round", scale: 0.6 + rnd() * 0.32 });
  }
  return out;
})();

/** Benches around the fountain, facing it. */
export const BENCHES: readonly { at: Point; angle: number }[] = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
  const r = FOUNTAIN.radius + 1.25;
  return {
    at: [FOUNTAIN.center[0] + Math.cos(a) * r, FOUNTAIN.center[1] + Math.sin(a) * r] as Point,
    angle: -a + Math.PI / 2,
  };
});
