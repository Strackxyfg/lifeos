import { describe, expect, it } from "vitest";
import { CEREBRUM, cerebrum, folia, noise3, sulci } from "@/lib/hub/brain-shape";

/** Evenly spread directions on the sphere (Fibonacci lattice). */
function directions(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  return out;
}

describe("the crystal brain's shape", () => {
  it("is the same brain every time, and its two hemispheres mirror each other", () => {
    for (const [x, y, z] of directions(400)) {
      expect(cerebrum(x, y, z)).toEqual(cerebrum(x, y, z));
      expect(cerebrum(-x, y, z)).toEqual(cerebrum(x, y, z));
    }
  });

  it("stays a brain: bounded radius, folds between 0 and 1", () => {
    for (const [x, y, z] of directions(3000)) {
      const p = cerebrum(x, y, z);
      expect(p.radius).toBeGreaterThan(0.3);
      expect(p.radius).toBeLessThan(1);
      expect(p.fold).toBeGreaterThanOrEqual(0);
      expect(p.fold).toBeLessThanOrEqual(1);
    }
  });

  it("is longer than wide, and flatter underneath than on top", () => {
    expect(cerebrum(0, 0, 1).radius).toBeGreaterThan(cerebrum(1, 0, 0).radius);
    expect(cerebrum(0, 0, -1).radius).toBeGreaterThan(cerebrum(1, 0, 0).radius);
    // Off the midline, so the fissure does not interfere.
    expect(cerebrum(0.35, -1, 0).radius).toBeLessThan(cerebrum(0.35, 1, 0).radius);
    expect(CEREBRUM.down).toBeLessThan(CEREBRUM.up);
  });

  it("has a fissure between the hemispheres along the top", () => {
    for (const z of [-0.4, 0, 0.4]) {
      const mid = cerebrum(0, 1, z);
      const side = cerebrum(0.25, 1, z);
      expect(mid.radius).toBeLessThan(side.radius * 0.95);
      expect(mid.fold).toBe(1);
    }
  });

  it("cuts narrow sulci between wide gyri, as a real cortex", () => {
    const folds = directions(4000).map(([x, y, z]) => sulci(Math.abs(x) * 3.6, y * 3.6, z * 3.6));
    const deep = folds.filter((f) => f > 0.5).length / folds.length;
    // Grooves, not a surface of holes: a minority of the surface, but a real network.
    expect(deep).toBeGreaterThan(0.05);
    expect(deep).toBeLessThan(0.35);
  });

  it("draws the cerebellum's folia as fine parallel ridges", () => {
    const along = [0, 0.05, 0.1, 0.15].map((y) => folia(y, 0));
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(0.5);
    for (let y = -1; y <= 1; y += 0.1) {
      expect(folia(y, 0)).toBeGreaterThanOrEqual(0);
      expect(folia(y, 0)).toBeLessThanOrEqual(1);
    }
  });

  it("uses smooth noise: close points, close values", () => {
    for (const [x, y, z] of directions(200)) {
      const a = noise3(x * 4, y * 4, z * 4);
      const b = noise3(x * 4 + 1e-4, y * 4, z * 4);
      expect(Math.abs(a - b)).toBeLessThan(1e-2);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});
