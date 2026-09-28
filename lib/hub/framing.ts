import { DISTRICTS, facing, type District, type Vec3, type View } from "./districts";
import { DOCK, ISLET_OUTLINE, MAIN_OUTLINE } from "./island";

/**
 * Framing the whole island on any screen.
 *
 * Rather than a fixed camera that crops the lighthouse on a laptop and floats
 * the island in empty sea on a wide monitor, the overview is solved: the
 * camera keeps its angle (looking down at 32°, facing north) and moves to the
 * distance where every rooftop and the whole coast fit — leaving the top of
 * the screen to the heads-up display and the band of sky, the bottom to the
 * cards.
 */

export const HUB_FOV = 35;
const RAD = Math.PI / 180;
const PITCH = 32 * RAD;

/** Where on screen the island may go, in normalised device coordinates. */
export const FRAME = { side: 0.93, top: 0.62, bottom: -0.6 };

/** What must be seen: the coastline, every building's top corners, the jetty's end. */
export const FRAME_POINTS: readonly Vec3[] = [
  ...MAIN_OUTLINE.filter((_, i) => i % 3 === 0).map(([x, z]): Vec3 => [x, 0, z]),
  ...ISLET_OUTLINE.filter((_, i) => i % 4 === 0).map(([x, z]): Vec3 => [x, 0, z]),
  ...DISTRICTS.flatMap((d) =>
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].map(([sx, sz]): Vec3 => [d.at[0] + sx * d.radius * 0.8, d.height, d.at[1] + sz * d.radius * 0.8])
  ),
  [DOCK.to[0], 0, DOCK.to[1]],
];

/** A point's position on screen (NDC) and its depth, for a camera looking at `target`. */
export function project(p: Vec3, view: View, aspect: number, fov = HUB_FOV): { x: number; y: number; depth: number } {
  const [cx, cy, cz] = view.position;
  let fx = view.target[0] - cx;
  let fy = view.target[1] - cy;
  let fz = view.target[2] - cz;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,1,0), normalised; up = right × forward.
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const vx = p[0] - cx;
  const vy = p[1] - cy;
  const vz = p[2] - cz;
  const depth = vx * fx + vy * fy + vz * fz;
  const tanV = Math.tan((fov / 2) * RAD);
  const tanH = tanV * aspect;
  return {
    x: (vx * rx + vz * rz) / (depth * tanH),
    y: (vx * ux + vy * uy + vz * uz) / (depth * tanV),
    depth,
  };
}

function viewAt(target: Vec3, distance: number): View {
  return {
    position: [target[0], target[1] + Math.sin(PITCH) * distance, target[2] + Math.cos(PITCH) * distance],
    target,
  };
}

function extent(view: View, aspect: number, fov: number) {
  let maxX = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of FRAME_POINTS) {
    const s = project(p, view, aspect, fov);
    maxX = Math.max(maxX, Math.abs(s.x));
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  return { maxX, minY, maxY };
}

/**
 * The whole island, as large as the screen allows. For a distance, the view
 * is first slid up or down so the island sits in the middle of its allowed
 * band; then the distance is bisected to the closest one where it all fits.
 */
export function overview(aspect: number, fov = HUB_FOV): View {
  const upY = Math.cos(PITCH);
  const upZ = -Math.sin(PITCH);
  const centred = (distance: number): View => {
    let target: Vec3 = [0, 0.6, -0.5];
    for (let i = 0; i < 4; i++) {
      const e = extent(viewAt(target, distance), aspect, fov);
      const shift = (e.maxY + e.minY) / 2 - (FRAME.top + FRAME.bottom) / 2;
      // One unit of NDC at the target is distance·tan(fov/2) world units.
      const world = shift * distance * Math.tan((fov / 2) * RAD);
      target = [target[0], target[1] + upY * world, target[2] + upZ * world];
    }
    return viewAt(target, distance);
  };
  const fits = (v: View) => {
    const e = extent(v, aspect, fov);
    return e.maxX <= FRAME.side && e.maxY <= FRAME.top + 0.005 && e.minY >= FRAME.bottom - 0.005;
  };
  let lo = 12;
  let hi = 260;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (fits(centred(mid))) hi = mid;
    else lo = mid;
  }
  return centred(hi);
}

/* ── One building, beside its panel ──────────────────────────────── */

/** Turns tried around a building's axis, in order: a three-quarter view first. */
const TURNS = [0.38, -0.38, 0.62, -0.62, 0.15, -0.15, 0.9, -0.9];
/** A close-up looks down less than the overview: the facade matters. */
const FOCUS_PITCH = 24 * RAD;

/**
 * Where on screen a building goes while its panel is open: the left part of
 * a wide screen (the panel is on the right), the top of a narrow one (the
 * panel is a sheet at the bottom).
 */
export function focusBox(aspect: number) {
  return aspect >= 1.1
    ? { minX: -0.9, maxX: 0.18, minY: -0.66, maxY: 0.62 }
    : { minX: -0.86, maxX: 0.86, minY: 0.04, maxY: 0.78 };
}

/** The corners of a building's bounding box. */
function cornersOf(d: District): Vec3[] {
  const r = d.radius * 0.95;
  const out: Vec3[] = [];
  for (const y of [0, d.height]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push([d.at[0] + sx * r, y, d.at[1] + sz * r]);
  return out;
}

/**
 * How free a viewpoint is: how far the camera stays from every other
 * building, and whether one stands between it and its subject's middle. A
 * building the camera is above does not count; one in the line of sight
 * rules the viewpoint out.
 */
export function clearance(position: Vec3, subject: District): { clear: boolean; margin: number } {
  const aim: Vec3 = [subject.at[0], subject.height * 0.5, subject.at[1]];
  let margin = Infinity;
  for (const o of DISTRICTS) {
    if (o.id === subject.id) continue;
    const [ox, oz] = o.at;
    if (position[1] < o.height + 1) margin = Math.min(margin, Math.hypot(position[0] - ox, position[2] - oz) - o.radius);
    for (let k = 1; k < 32; k++) {
      const t = k / 32;
      const x = position[0] + (aim[0] - position[0]) * t;
      const y = position[1] + (aim[1] - position[1]) * t;
      const z = position[2] + (aim[2] - position[2]) * t;
      if (y < o.height + 0.3 && Math.hypot(x - ox, z - oz) < o.radius + 0.3) return { clear: false, margin: -1 };
    }
  }
  return { clear: margin > 0.8 && position[1] > 1, margin };
}

function basis(view: View) {
  let fx = view.target[0] - view.position[0];
  let fy = view.target[1] - view.position[1];
  let fz = view.target[2] - view.position[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  const rl = Math.hypot(fz, fx) || 1;
  const right: Vec3 = [-fz / rl, 0, fx / rl];
  const up: Vec3 = [-right[2] * fy, right[2] * fx - right[0] * fz, right[0] * fy];
  return { right, up };
}

const move = (v: View, by: Vec3): View => ({
  position: [v.position[0] + by[0], v.position[1] + by[1], v.position[2] + by[2]],
  target: [v.target[0] + by[0], v.target[1] + by[1], v.target[2] + by[2]],
});

/**
 * A three-quarter close-up of one building, solved like the overview: from
 * the first turn around it that sees it unobstructed, at the distance where
 * the whole building fits the part of the screen its panel leaves free.
 */
export function focusView(d: District, aspect: number, fov = HUB_FOV): View {
  const box = focusBox(aspect);
  const corners = cornersOf(d);
  const centre: Vec3 = [d.at[0], d.height * 0.45, d.at[1]];
  const tanV = Math.tan((fov / 2) * RAD);
  const tanH = tanV * aspect;

  const extentOf = (v: View) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of corners) {
      const s = project(p, v, aspect, fov);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    return { minX, maxX, minY, maxY };
  };

  const placed = (angle: number, distance: number): View => {
    const cp = Math.cos(FOCUS_PITCH);
    let v: View = {
      position: [
        centre[0] + Math.sin(angle) * cp * distance,
        centre[1] + Math.sin(FOCUS_PITCH) * distance,
        centre[2] + Math.cos(angle) * cp * distance,
      ],
      target: centre,
    };
    // Slide the camera sideways and up so the building sits in its box.
    for (let i = 0; i < 4; i++) {
      const e = extentOf(v);
      const sx = (e.minX + e.maxX) / 2 - (box.minX + box.maxX) / 2;
      const sy = (e.minY + e.maxY) / 2 - (box.minY + box.maxY) / 2;
      const depth = project(centre, v, aspect, fov).depth;
      const { right, up } = basis(v);
      const k = depth * tanH * sx;
      const j = depth * tanV * sy;
      v = move(v, [right[0] * k + up[0] * j, right[1] * k + up[1] * j, right[2] * k + up[2] * j]);
    }
    return v;
  };

  const fits = (v: View) => {
    const e = extentOf(v);
    return e.minX >= box.minX && e.maxX <= box.maxX && e.minY >= box.minY && e.maxY <= box.maxY;
  };

  // Of the clear viewpoints, the one with the most room around the camera — a
  // neighbour looming in the foreground spoils a portrait even when it hides
  // nothing — with a small preference for staying near the building's axis.
  let best: { view: View; score: number } | null = null;
  let fallback: { view: View; margin: number } | null = null;
  for (const turn of TURNS) {
    const angle = facing(d) + turn;
    let lo = 2;
    let hi = 120;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(placed(angle, mid))) hi = mid;
      else lo = mid;
    }
    const view = placed(angle, hi);
    const c = clearance(view.position, d);
    if (c.clear) {
      const score = Math.min(c.margin, 7) - Math.abs(turn) * 1.5;
      if (!best || score > best.score + 1e-9) best = { view, score };
    } else if (c.margin >= 0 && (!fallback || c.margin > fallback.margin)) {
      fallback = { view, margin: c.margin };
    }
  }
  // Nothing fully clear: the least obstructed, else from above.
  return best?.view ?? fallback?.view ?? placed(facing(d), 40);
}
