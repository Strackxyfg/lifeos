import { hash } from "./text";

/**
 * Where each note sits in the 3D brain.
 *
 * Positions are derived from the note's id, not stored and not random: the
 * same note is in the same place on every visit, so the brain becomes a space
 * you learn your way around. Adding a note never moves the others.
 *
 * Each note orbits its region's anchor at a distance between MIN and MAX, in a
 * direction set by its id — a cluster per region, loosely packed.
 */
export const NODE_MIN_RADIUS = 0.1;
export const NODE_MAX_RADIUS = 0.34;

export type Vec3 = [number, number, number];

export function nodePosition(id: string, anchor: Vec3): Vec3 {
  // Two independent hashes: one for direction, one for distance.
  const h1 = hash(`dir:${id}`);
  const h2 = hash(`rad:${id}`);

  // Uniform direction on the sphere (inverse-CDF on the polar angle), so the
  // cluster doesn't bunch at the poles.
  const u = (h1 & 0xffff) / 0xffff;
  const v = (h1 >>> 16) / 0xffff;
  const theta = Math.acos(2 * u - 1);
  const phi = 2 * Math.PI * v;

  const t = h2 / 0xffffffff;
  const r = NODE_MIN_RADIUS + t * (NODE_MAX_RADIUS - NODE_MIN_RADIUS);

  return [
    anchor[0] + r * Math.sin(theta) * Math.cos(phi),
    anchor[1] + r * Math.cos(theta),
    anchor[2] + r * Math.sin(theta) * Math.sin(phi),
  ];
}

/** How many notes the scene draws. Past this, a brain becomes noise. */
export const MAX_RENDERED_NODES = 180;
