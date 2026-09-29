import { describe, it, expect } from "vitest";
import { DIMENSIONS, INTERIORS, ROUND_ROOMS, type Item } from "@/lib/hub/interiors";
import type { DistrictId } from "@/lib/hub/districts";

type P = [number, number];

/** The four corners of an item's (turned) footprint. */
function corners(item: Item): P[] {
  const dim = DIMENSIONS[item.kind];
  const [w, d] = item.size ?? [dim.w, dim.d];
  const r = item.rot ?? 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // three's turn about +Y: (x, z) → (x cos + z sin, −x sin + z cos).
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, z]) => [item.at[0] + x * c + z * s, item.at[2] - x * s + z * c]);
}

/** Separating-axis test for two convex quads. */
function overlap(a: P[], b: P[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % 4];
      const n: P = [z1 - z2, x2 - x1];
      const proj = (q: P[]) => q.map(([x, z]) => x * n[0] + z * n[1]);
      const pa = proj(a);
      const pb = proj(b);
      // Touching is fine; a millimetre of overlap is not.
      if (Math.max(...pa) <= Math.min(...pb) + 1e-3 || Math.max(...pb) <= Math.min(...pa) + 1e-3) return false;
    }
  }
  return true;
}

const entries = Object.entries(INTERIORS) as [DistrictId, NonNullable<(typeof INTERIORS)[DistrictId]>][];

describe("the buildings' interiors", () => {
  it("furnish every building that has glass", () => {
    for (const id of ["assistant", "team", "projects", "finance", "relations", "agent", "brain"] as DistrictId[]) {
      const interior = INTERIORS[id];
      expect(interior, id).toBeDefined();
      const count = interior!.rooms.reduce((n, r) => n + r.items.length, 0);
      expect(count, id).toBeGreaterThanOrEqual(8);
    }
  });

  it("keeps everything inside its room, on its floor, under its ceiling", () => {
    for (const [id, interior] of entries) {
      for (const room of interior.rooms) {
        for (const item of room.items) {
          const label = `${id} ${item.kind} at ${item.at.join(",")}`;
          for (const [x, z] of corners(item)) {
            expect(x, label).toBeGreaterThanOrEqual(room.min[0] - 1e-6);
            expect(x, label).toBeLessThanOrEqual(room.max[0] + 1e-6);
            expect(z, label).toBeGreaterThanOrEqual(room.min[2] - 1e-6);
            expect(z, label).toBeLessThanOrEqual(room.max[2] + 1e-6);
            const radius = ROUND_ROOMS[id];
            if (radius) expect(Math.hypot(x, z), label).toBeLessThanOrEqual(radius);
          }
          const h = DIMENSIONS[item.kind].h;
          expect(item.at[1], label).toBeGreaterThanOrEqual(room.min[1] - 1e-6);
          expect(item.at[1] + (DIMENSIONS[item.kind].free ? 0 : h), label).toBeLessThanOrEqual(room.max[1] + 1e-6);
        }
      }
    }
  });

  it("never stands one thing in another", () => {
    for (const [id, interior] of entries) {
      for (const room of interior.rooms) {
        const solid = room.items.filter((i) => !DIMENSIONS[i.kind].free);
        for (let i = 0; i < solid.length; i++) {
          for (let j = i + 1; j < solid.length; j++) {
            const a = solid[i];
            const b = solid[j];
            // Things stacked (a machine on a counter, a model on a table) do not collide.
            const ay = [a.at[1], a.at[1] + DIMENSIONS[a.kind].h];
            const by = [b.at[1], b.at[1] + DIMENSIONS[b.kind].h];
            if (ay[1] <= by[0] + 1e-6 || by[1] <= ay[0] + 1e-6) continue;
            expect(overlap(corners(a), corners(b)), `${id}: ${a.kind}@${a.at.join(",")} vs ${b.kind}@${b.at.join(",")}`).toBe(false);
          }
        }
      }
    }
  });

  it("gives each building a light of its own hue", () => {
    const hue = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const r = ((n >> 16) & 255) / 255;
      const g = ((n >> 8) & 255) / 255;
      const b = (n & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const hues = entries.map(([id, i]) => [id, hue(i.light)] as const);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i][1] - hues[j][1]);
        expect(Math.min(d, 360 - d), `${hues[i][0]} vs ${hues[j][0]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("hangs every lamp inside one of the building's rooms", () => {
    for (const [id, interior] of entries) {
      for (const [x, y, z] of interior.lamps) {
        const inside = interior.rooms.some((r) => x >= r.min[0] && x <= r.max[0] && y >= r.min[1] && y <= r.max[1] && z >= r.min[2] && z <= r.max[2]);
        expect(inside, `${id} lamp ${x},${y},${z}`).toBe(true);
      }
    }
  });
});
