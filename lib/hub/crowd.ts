import { DISTRICTS, districtById, facing } from "./districts";
import { BENCHES, DOCK, FOUNTAIN, onLand, PATHS, PLAZA_LAMPS, seeded, TREES, WATERFRONT_LAMPS, type Point } from "./island";

/**
 * The island's people and what each is doing: walking the paths and the
 * plaza, a couple of joggers, friends talking in small groups, people on
 * the benches round the fountain and at the café's tables, someone fishing
 * at the end of the jetty. The scene animates them (`lib/hub/gait.ts`);
 * this decides who, where — deterministically, so the island is the same
 * place from one visit to the next.
 */

export type Route = { kind: "loop"; center: Point; radius: number } | { kind: "line"; from: Point; to: Point };

export const ROUTES: readonly Route[] = [
  { kind: "loop", center: FOUNTAIN.center, radius: 3.45 },
  { kind: "loop", center: FOUNTAIN.center, radius: 4.45 },
  ...PATHS.map((p): Route => ({ kind: "line", from: p.from, to: p.to })),
  { kind: "line", from: DOCK.from, to: [DOCK.to[0], DOCK.to[1] - 0.8] },
];

export function routeLength(r: Route): number {
  return r.kind === "loop" ? 2 * Math.PI * r.radius : Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
}

/**
 * Where someone `s` units along a route is, and which way they face
 * (heading: the turn about +Y from facing +Z). `lane` keeps them to one
 * side — to the right, as people do.
 */
export function along(r: Route, s: number, lane: number): { x: number; z: number; heading: number } {
  if (r.kind === "loop") {
    const a = s / r.radius;
    const rr = r.radius + lane;
    // Moving with increasing angle: the tangent is (−sin a, cos a).
    return { x: r.center[0] + Math.cos(a) * rr, z: r.center[1] + Math.sin(a) * rr, heading: Math.atan2(-Math.sin(a), Math.cos(a)) };
  }
  const len = routeLength(r);
  const u = ((s % (2 * len)) + 2 * len) % (2 * len);
  const back = u > len;
  const t = back ? 2 - u / len : u / len;
  const dx = r.to[0] - r.from[0];
  const dz = r.to[1] - r.from[1];
  const nx = (-dz / len) * lane * (back ? -1 : 1);
  const nz = (dx / len) * lane * (back ? -1 : 1);
  const heading = Math.atan2(dx, dz) + (back ? Math.PI : 0);
  return { x: r.from[0] + dx * t + nx, z: r.from[1] + dz * t + nz, heading };
}

/** A building's own coordinates → the island's. */
export function toWorld(id: Parameters<typeof districtById>[0], x: number, z: number): Point {
  const d = districtById(id);
  const f = facing(d);
  return [d.at[0] + x * Math.cos(f) + z * Math.sin(f), d.at[1] - x * Math.sin(f) + z * Math.cos(f)];
}

export type Role =
  | { kind: "walk"; route: number; offset: number; speed: number; lane: number; run: number }
  | { kind: "sit"; at: Point; heading: number; seat: number }
  | { kind: "stand"; at: Point; heading: number };

export interface Person {
  role: Role;
  /** Who goes home first after dark: the higher, the earlier. */
  rank: number;
  seed: number;
  shirt: string;
  trousers: string;
  skin: string;
  hair: string;
  /** Short sleeves: forearms in skin. */
  shortSleeves: boolean;
}

/** Seat heights: the benches round the fountain, the café terrace's chairs. */
export const BENCH_SEAT = 0.155;
export const TERRACE_SEAT = 0.13;

export interface Seat {
  at: Point;
  heading: number;
  seat: number;
}

/** Where people sit: two to a bench, facing the fountain; round the café's terrace tables. */
export function seats(): Seat[] {
  const out: Seat[] = [];
  for (const b of BENCHES) {
    const a = Math.atan2(b.at[1] - FOUNTAIN.center[1], b.at[0] - FOUNTAIN.center[0]);
    const inward: Point = [-Math.cos(a), -Math.sin(a)];
    const heading = Math.atan2(inward[0], inward[1]);
    // Along the bench (its local x, turned by its angle), and a little
    // forward on the seat so the knees clear its front edge.
    const ax: Point = [Math.cos(b.angle), -Math.sin(b.angle)];
    for (const side of [-1, 1]) {
      out.push({
        at: [b.at[0] + ax[0] * side * 0.22 + inward[0] * 0.06, b.at[1] + ax[1] * side * 0.22 + inward[1] * 0.06],
        heading,
        seat: BENCH_SEAT,
      });
    }
  }
  // The terrace: three tables in front of the café, a chair either side.
  const f = facing(districtById("assistant"));
  for (const tx of [-1.25, 0, 1.25]) {
    for (const side of [-1, 1]) {
      const at = toWorld("assistant", tx + side * 0.34, 1.7);
      // Facing the table: in the café's frame, towards −side along x.
      out.push({ at, heading: Math.atan2(-side, 0) + f, seat: TERRACE_SEAT });
    }
  }
  return out;
}

const TREE_CLEARANCE = 0.8;

/** Places where a few people can stand talking: beside the paths, clear of trees, lamps and benches. */
export function meetingSpots(): Point[] {
  const lamps = [...PLAZA_LAMPS, ...WATERFRONT_LAMPS];
  const out: Point[] = [];
  for (const p of PATHS) {
    const dx = p.to[0] - p.from[0];
    const dz = p.to[1] - p.from[1];
    const len = Math.hypot(dx, dz);
    for (const t of [0.4, 0.65]) {
      for (const side of [1, -1]) {
        const c: Point = [p.from[0] + dx * t + (-dz / len) * side * 1.0, p.from[1] + dz * t + (dx / len) * side * 1.0];
        if (!onLand(c)) continue;
        if (TREES.some((tr) => Math.hypot(tr.at[0] - c[0], tr.at[1] - c[1]) < TREE_CLEARANCE * tr.scale + 0.3)) continue;
        if (lamps.some((l) => Math.hypot(l[0] - c[0], l[1] - c[1]) < 0.45)) continue;
        if (BENCHES.some((b) => Math.hypot(b.at[0] - c[0], b.at[1] - c[1]) < 0.8)) continue;
        if (DISTRICTS.some((d) => Math.hypot(d.at[0] - c[0], d.at[1] - c[1]) < d.radius + 0.25)) continue;
        if (out.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < 2)) continue;
        out.push(c);
      }
    }
  }
  return out;
}

const SHIRTS = ["#2f4a7a", "#c8553d", "#f2f2ee", "#2d2d33", "#7b9e87", "#d9a441", "#5b6d91", "#a14d6b", "#e8d9c4", "#3f7f93", "#8c3b3b", "#e6e6e6"];
const TROUSERS = ["#2b3242", "#3b3b40", "#1f2530", "#6b5b48", "#c9bfae", "#34495e", "#4a4a4a"];
const SKIN = ["#f1c7a5", "#d9a47c", "#a9714b", "#7a4b2f", "#e8b893", "#c68e62"];
const HAIR = ["#2a1d15", "#4a3222", "#1a1a1a", "#8a6a3c", "#c9a86a", "#6b3a22", "#9a9a9a"];

/** Everyone on the island, for this many people. */
export function crowd(count: number): Person[] {
  const rnd = seeded(1234 + count);
  const people: Person[] = [];
  const dress = (): Omit<Person, "role" | "rank" | "seed"> => ({
    shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)],
    trousers: TROUSERS[Math.floor(rnd() * TROUSERS.length)],
    skin: SKIN[Math.floor(rnd() * SKIN.length)],
    hair: HAIR[Math.floor(rnd() * HAIR.length)],
    shortSleeves: rnd() < 0.45,
  });
  const add = (role: Role, rank: number) => {
    if (people.length < count) people.push({ role, rank, seed: people.length * 7 + 3, ...dress() });
  };

  // Someone fishing at the end of the jetty, looking out to sea, till late.
  add({ kind: "stand", at: [DOCK.to[0] + 0.35, DOCK.to[1] - 0.45], heading: 0.15 }, 0.1);
  // Joggers, round the plaza's outer ring — they are out early and late.
  const joggers = count >= 20 ? 2 : 1;
  for (let i = 0; i < joggers; i++) add({ kind: "walk", route: 1, offset: i * 13, speed: i % 2 ? -0.82 : 0.78, lane: 0.35, run: 1 }, 0.2 + rnd() * 0.3);
  // Friends talking.
  const spots = meetingSpots();
  const groups = count >= 20 ? [3, 2, 2] : count >= 10 ? [2] : [];
  groups.forEach((size, g) => {
    const c = spots[g % Math.max(1, spots.length)];
    if (!c) return;
    const rank = 0.35 + rnd() * 0.4;
    for (let k = 0; k < size; k++) {
      const a = (k / size) * Math.PI * 2 + g;
      const at: Point = [c[0] + Math.cos(a) * 0.17, c[1] + Math.sin(a) * 0.17];
      // Facing the group's centre.
      add({ kind: "stand", at, heading: Math.atan2(c[0] - at[0], c[1] - at[1]) }, rank);
    }
  });
  // People sitting: benches and the café's terrace, a share of the crowd.
  const all = seats();
  const sitting = Math.round(count * 0.27);
  for (let i = 0; i < sitting && i < all.length; i++) {
    // Spread over the seats rather than filling the first benches.
    const s = all[(i * 5) % all.length];
    if (people.some((p) => p.role.kind === "sit" && p.role.at === s.at)) continue;
    add({ kind: "sit", ...s }, 0.3 + rnd() * 0.6);
  }
  // Everyone else walks: the plaza's rings and the paths to the doors.
  while (people.length < count) {
    const i = people.length;
    const route = i % 3 === 0 ? i % 2 : 2 + (i % (ROUTES.length - 2));
    const dir = rnd() < 0.5 ? -1 : 1;
    add({ kind: "walk", route, offset: rnd() * 60, speed: dir * (0.3 + rnd() * 0.18), lane: 0.1 + rnd() * 0.22, run: 0 }, rnd());
  }
  return people;
}
