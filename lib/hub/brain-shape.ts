/**
 * The shape of the crystal brain under the second brain's dome: a function
 * from a direction to a radius, applied to a finely divided sphere.
 *
 * Anatomy, simplified but in the right places (x: left–right, y: up, z: front):
 * - the cerebrum, an ellipsoid longer than wide, flatter underneath;
 * - the longitudinal fissure between the two hemispheres, a groove along
 *   the top from front to back;
 * - the temporal lobes, low on each side, towards the front;
 * - gyri and sulci: ridged noise, warped so the folds meander, read on the
 *   mirrored direction so both hemispheres fold alike, as real ones nearly do.
 * The cerebellum and the brain stem are separate pieces (`CEREBELLUM`,
 * `STEM`), placed under the back of the cerebrum.
 *
 * `fold` says how deep in a sulcus a point lies (0 on a crest, 1 at the
 * bottom): the crystal is thinner there, so its light shows through more.
 *
 * Pure and deterministic: no three.js, no randomness — the same brain on
 * every screen, and the tests can hold it to its shape.
 */

export interface BrainPoint {
  /** Distance from the centre along the direction asked. */
  radius: number;
  /** 0 on a gyrus' crest, 1 at the bottom of a sulcus. */
  fold: number;
}

/** Semi-axes of the cerebrum: half-width, half-height above and below, half-length. */
export const CEREBRUM = { x: 0.7, up: 0.58, down: 0.4, z: 0.86 } as const;

/** The cerebellum: an ellipsoid under the back of the cerebrum (centre and semi-axes). */
export const CEREBELLUM = { at: [0, -0.3, -0.56] as const, size: [0.44, 0.22, 0.3] as const };

/** The brain stem: from under the middle of the brain, down and a little back. */
export const STEM = { top: [0, -0.26, -0.22] as const, bottom: [0, -0.72, -0.34] as const, radius: [0.13, 0.09] as const };

/** How deep the sulci cut, as a share of the radius. */
const FOLD_DEPTH = 0.07;
/** Noise cells per unit of length on the unit sphere: about a dozen gyri front to back. */
const FOLD_FREQUENCY = 3.6;

const fract = (v: number) => v - Math.floor(v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A lattice value in [0, 1), from integer coordinates — a stable hash, no state. */
function lattice(i: number, j: number, k: number): number {
  return fract(Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453);
}

/** Smooth value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (di: number, dj: number, dk: number) => lattice(i + di, j + dj, k + dk);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w
  );
}

/**
 * Sulci: 1 in a groove, 0 on the gyri between. The grooves are the
 * mid-level lines of smooth noise (where it crosses one half), which wind
 * and branch across the surface as real sulci do; a high power keeps them
 * narrow, so the gyri between stay wide and rounded. Main sulci, and finer
 * secondary ones at twice the frequency, shallower.
 */
export function sulci(x: number, y: number, z: number): number {
  // The warp makes the folds wander instead of following the noise lattice.
  const wx = x + 0.6 * (noise3(x * 0.7 + 3.1, y * 0.7, z * 0.7) - 0.5);
  const wy = y + 0.6 * (noise3(x * 0.7, y * 0.7 + 7.7, z * 0.7) - 0.5);
  const wz = z + 0.6 * (noise3(x * 0.7, y * 0.7, z * 0.7 + 1.9) - 0.5);
  const groove = (n: number, sharpness: number) => Math.pow(1 - Math.abs(2 * n - 1), sharpness);
  const main = groove(noise3(wx, wy, wz), 7);
  const secondary = groove(noise3(wx * 2.1 + 17.3, wy * 2.1 - 9.1, wz * 2.1 + 5.7), 9) * 0.55;
  return Math.min(1, main + secondary);
}

/**
 * The cerebrum's surface along a unit direction `(dx, dy, dz)`. Directions
 * need not be normalised: they are.
 */
export function cerebrum(dx: number, dy: number, dz: number): BrainPoint {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len;
  const y = dy / len;
  const z = dz / len;

  // The ellipsoid, flatter below the equator.
  const b = y >= 0 ? CEREBRUM.up : CEREBRUM.down;
  const base = 1 / Math.sqrt((x / CEREBRUM.x) ** 2 + (y / b) ** 2 + (z / CEREBRUM.z) ** 2);

  // Temporal lobes: low on each side, towards the front.
  const ax = Math.abs(x);
  const temporal = 0.07 * Math.exp(-((ax - 0.72) ** 2 / 0.05 + (y + 0.38) ** 2 / 0.05 + (z - 0.12) ** 2 / 0.14));

  // The fissure between the hemispheres, deepest on top, fading underneath.
  const fissure = 0.17 * Math.exp(-((x / 0.055) ** 2)) * smoothstep(-0.25, 0.3, y);

  // Folds, on the mirrored direction; shallower on the flat underside.
  const sulcus = sulci(ax * FOLD_FREQUENCY, y * FOLD_FREQUENCY, z * FOLD_FREQUENCY);
  const depth = FOLD_DEPTH * (0.45 + 0.55 * smoothstep(-0.75, -0.2, y));

  const radius = base * (1 - fissure) + temporal - depth * sulcus * base;
  // In the fissure the crystal is thinnest of all: it glows like a sulcus.
  const fold = Math.min(1, Math.max(0, Math.max(sulcus, fissure / 0.17)));
  return { radius, fold };
}

/**
 * The cerebellum's folia: fine, nearly horizontal ridges, as on the real one.
 * `y` is height within the cerebellum, `-1..1`.
 */
export function folia(y: number, z: number): number {
  const s = 0.5 + 0.5 * Math.sin((y * 9 + z * 1.5) * Math.PI * 2);
  return s * s;
}
