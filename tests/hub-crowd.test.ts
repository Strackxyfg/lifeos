import { describe, it, expect } from "vitest";
import { along, BENCH_SEAT, crowd, meetingSpots, ROUTES, routeLength, seats } from "@/lib/hub/crowd";
import { DISTRICTS } from "@/lib/hub/districts";
import { FOUNTAIN, onLand, TREES } from "@/lib/hub/island";

describe("the crowd", () => {
  it("is the requested size, the same every time", () => {
    for (const n of [12, 26, 40]) {
      expect(crowd(n)).toHaveLength(n);
      expect(JSON.stringify(crowd(n))).toBe(JSON.stringify(crowd(n)));
    }
  });

  it("mixes walkers, joggers, people talking and people sitting", () => {
    const people = crowd(40);
    const kinds = (k: string) => people.filter((p) => p.role.kind === k).length;
    expect(kinds("walk")).toBeGreaterThan(15);
    expect(kinds("sit")).toBeGreaterThanOrEqual(8);
    expect(kinds("stand")).toBeGreaterThanOrEqual(5);
    expect(people.filter((p) => p.role.kind === "walk" && p.role.run > 0).length).toBe(2);
  });

  it("never seats two people on the same seat", () => {
    const sitting = crowd(40).filter((p) => p.role.kind === "sit");
    for (let i = 0; i < sitting.length; i++)
      for (let j = i + 1; j < sitting.length; j++) {
        const a = sitting[i].role as { at: readonly [number, number] };
        const b = sitting[j].role as { at: readonly [number, number] };
        expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeGreaterThan(0.2);
      }
  });

  it("puts everyone who stays put on land, out of the fountain and the trees", () => {
    for (const p of crowd(40)) {
      if (p.role.kind === "walk") continue;
      const at = p.role.at;
      expect(onLand(at), JSON.stringify(p.role)).toBe(true);
      expect(Math.hypot(at[0] - FOUNTAIN.center[0], at[1] - FOUNTAIN.center[1])).toBeGreaterThan(FOUNTAIN.radius + 0.3);
    }
    for (const s of meetingSpots()) {
      for (const t of TREES) expect(Math.hypot(t.at[0] - s[0], t.at[1] - s[1])).toBeGreaterThan(0.6);
      for (const d of DISTRICTS) expect(Math.hypot(d.at[0] - s[0], d.at[1] - s[1])).toBeGreaterThan(d.radius);
    }
  });

  it("seats people facing the fountain on the benches", () => {
    for (const s of seats().filter((x) => x.seat === BENCH_SEAT)) {
      const toFountain = Math.atan2(FOUNTAIN.center[0] - s.at[0], FOUNTAIN.center[1] - s.at[1]);
      const d = Math.abs(((s.heading - toFountain + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      expect(d).toBeLessThan(0.3);
    }
  });
});

describe("routes", () => {
  it("face the way they go", () => {
    for (const r of ROUTES) {
      const len = routeLength(r);
      for (const s of [0.1 * len, 0.4 * len, 0.7 * len]) {
        const a = along(r, s, 0);
        const b = along(r, s + 0.01, 0);
        const moved = Math.atan2(b.x - a.x, b.z - a.z);
        const d = Math.abs(((a.heading - moved + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        expect(d).toBeLessThan(0.05);
      }
    }
  });

  it("keep walkers on land", () => {
    for (const r of ROUTES) {
      const len = routeLength(r);
      for (let s = 0; s < 2 * len; s += len / 20) {
        const p = along(r, s, 0.25);
        expect(onLand([p.x, p.z])).toBe(true);
      }
    }
  });
});
