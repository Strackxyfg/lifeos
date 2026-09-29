import * as THREE from "three";
import { wallPieces, type Rect } from "@/lib/hub/walls";

/**
 * Hollow buildings: four walls cut around their windows, a roof, floors —
 * one geometry per building, in three material groups:
 *
 *   0  the outside (façades, reveals, roof)
 *   1  the inside (walls, ceilings)
 *   2  the floors
 *
 * so that a window shows a room, lit by its own lamps, instead of a
 * reflection pasted on a block. The glass that fills the openings is built
 * alongside (`panes`).
 *
 * Coordinates are the building's own: its front faces +Z.
 */

export type V3 = [number, number, number];
export type Side = "front" | "back" | "left" | "right";

/** An opening, in the building's coordinates: `a` along the wall (x for front/back, z for the sides), `y` up. */
export interface Opening {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

export interface ShellSpec {
  min: V3;
  max: V3;
  /** Wall thickness. */
  wall: number;
  /** Roof slab thickness; 0 for none. */
  roof: number;
  openings?: Partial<Record<Side, Opening[]>>;
  /** Intermediate floors: the height of each slab's top, and its thickness. */
  slabs?: { y: number; t: number }[];
}

interface Buckets {
  pos: number[][];
  nor: number[][];
  uv: number[][];
}

const GROUPS = 3;

function newBuckets(): Buckets {
  return { pos: [[], [], []], nor: [[], [], []], uv: [[], [], []] };
}

/**
 * A quad from its centre, two half-extent axes and its normal: two
 * triangles, wound counter-clockwise seen from the side the normal faces.
 */
function quad(b: Buckets, group: number, c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, n: THREE.Vector3) {
  const corners = [
    c.clone().sub(ax).sub(ay),
    c.clone().add(ax).sub(ay),
    c.clone().add(ax).add(ay),
    c.clone().sub(ax).add(ay),
  ];
  // Make the winding agree with the normal.
  const e1 = corners[1].clone().sub(corners[0]);
  const e2 = corners[2].clone().sub(corners[0]);
  if (e1.cross(e2).dot(n) < 0) corners.reverse();
  const order = [0, 1, 2, 0, 2, 3];
  const planar = (p: THREE.Vector3): [number, number] =>
    Math.abs(n.y) > 0.5 ? [p.x, p.z] : Math.abs(n.x) > 0.5 ? [p.z, p.y] : [p.x, p.y];
  for (const i of order) {
    const p = corners[i];
    b.pos[group].push(p.x, p.y, p.z);
    b.nor[group].push(n.x, n.y, n.z);
    b.uv[group].push(...planar(p));
  }
}

/** An axis-aligned box; `groupOf(normal)` picks each face's material group. */
function box(b: Buckets, min: V3, max: V3, groupOf: (n: THREE.Vector3) => number) {
  const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const h = new THREE.Vector3((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
  if (h.x <= 0 || h.y <= 0 || h.z <= 0) return;
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [X, Z, Y],
    [X.clone().negate(), Z, Y],
    [Y, X, Z],
    [Y.clone().negate(), X, Z],
    [Z, X, Y],
    [Z.clone().negate(), X, Y],
  ];
  for (const [n, u, v] of faces) {
    const center = c.clone().add(n.clone().multiply(h));
    const ax = u.clone().multiply(h);
    const ay = v.clone().multiply(h);
    quad(b, groupOf(n), center, ax, ay, n);
  }
}

function wallFrame(spec: ShellSpec, side: Side) {
  const [x0, y0, z0] = spec.min;
  const [x1, y1, z1] = spec.max;
  const t = spec.wall;
  switch (side) {
    case "front":
      return { a0: x0, a1: x1, c0: z1 - t, c1: z1, inward: new THREE.Vector3(0, 0, -1), axis: "x" as const, y0, y1 };
    case "back":
      return { a0: x0, a1: x1, c0: z0, c1: z0 + t, inward: new THREE.Vector3(0, 0, 1), axis: "x" as const, y0, y1 };
    case "left":
      return { a0: z0 + t, a1: z1 - t, c0: x0, c1: x0 + t, inward: new THREE.Vector3(1, 0, 0), axis: "z" as const, y0, y1 };
    case "right":
      return { a0: z0 + t, a1: z1 - t, c0: x1 - t, c1: x1, inward: new THREE.Vector3(-1, 0, 0), axis: "z" as const, y0, y1 };
  }
}

const SIDES: Side[] = ["front", "back", "left", "right"];

/** The building's hollow body, as one geometry with three material groups. */
export function shellGeometry(spec: ShellSpec): THREE.BufferGeometry {
  const b = newBuckets();
  for (const side of SIDES) {
    const f = wallFrame(spec, side);
    const holes: Rect[] = (spec.openings?.[side] ?? []).map((o) => ({ u0: o.a0 - f.a0, u1: o.a1 - f.a0, v0: o.y0 - f.y0, v1: o.y1 - f.y0 }));
    const inside = (n: THREE.Vector3) => (n.dot(f.inward) > 0.5 ? 1 : 0);
    for (const p of wallPieces(f.a1 - f.a0, f.y1 - f.y0, holes)) {
      const a0 = f.a0 + p.u0;
      const a1 = f.a0 + p.u1;
      const ya = f.y0 + p.v0;
      const yb = f.y0 + p.v1;
      if (f.axis === "x") box(b, [a0, ya, f.c0], [a1, yb, f.c1], inside);
      else box(b, [f.c0, ya, a0], [f.c1, yb, a1], inside);
    }
  }
  const [x0, y0, z0] = spec.min;
  const [x1, y1, z1] = spec.max;
  const t = spec.wall;
  // The roof: its top is the outside, its underside a ceiling.
  if (spec.roof > 0) box(b, [x0 + t, y1 - spec.roof, z0 + t], [x1 - t, y1, z1 - t], (n) => (n.y < -0.5 ? 1 : 0));
  // Intermediate floors: floor on top, ceiling beneath, edges outside.
  for (const s of spec.slabs ?? []) {
    box(b, [x0 + t, s.y - s.t, z0 + t], [x1 - t, s.y, z1 - t], (n) => (n.y > 0.5 ? 2 : n.y < -0.5 ? 1 : 0));
  }
  // The ground floor.
  quad(
    b,
    2,
    new THREE.Vector3((x0 + x1) / 2, y0 + 0.004, (z0 + z1) / 2),
    new THREE.Vector3((x1 - x0) / 2 - t, 0, 0),
    new THREE.Vector3(0, 0, (z1 - z0) / 2 - t),
    new THREE.Vector3(0, 1, 0)
  );
  return assemble(b);
}

function assemble(b: Buckets): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  let start = 0;
  for (let i = 0; i < GROUPS; i++) {
    pos.push(...b.pos[i]);
    nor.push(...b.nor[i]);
    uv.push(...b.uv[i]);
    const count = b.pos[i].length / 3;
    if (count) g.addGroup(start, count, i);
    start += count;
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

/** Glass for every opening of a shell: one plane each, in the middle of the wall's thickness. */
export function panesGeometry(spec: ShellSpec): THREE.BufferGeometry {
  const b = newBuckets();
  for (const side of SIDES) {
    const f = wallFrame(spec, side);
    const mid = (f.c0 + f.c1) / 2;
    for (const o of spec.openings?.[side] ?? []) {
      const a0 = Math.max(f.a0, o.a0);
      const a1 = Math.min(f.a1, o.a1);
      const ya = Math.max(f.y0, o.y0);
      const yb = Math.min(f.y1, o.y1);
      if (a1 <= a0 || yb <= ya) continue;
      const outward = f.inward.clone().negate();
      const c =
        f.axis === "x"
          ? new THREE.Vector3((a0 + a1) / 2, (ya + yb) / 2, mid)
          : new THREE.Vector3(mid, (ya + yb) / 2, (a0 + a1) / 2);
      const along = f.axis === "x" ? new THREE.Vector3((a1 - a0) / 2, 0, 0) : new THREE.Vector3(0, 0, (a1 - a0) / 2);
      quad(b, 0, c, along, new THREE.Vector3(0, (yb - ya) / 2, 0), outward);
    }
  }
  return assemble(b);
}

/** The interior volume of a shell (inside its walls, above its floor, under its roof). */
export function interiorOf(spec: ShellSpec): { min: V3; max: V3 } {
  const t = spec.wall;
  return {
    min: [spec.min[0] + t, spec.min[1], spec.min[2] + t],
    max: [spec.max[0] - t, spec.max[1] - spec.roof, spec.max[2] - t],
  };
}
