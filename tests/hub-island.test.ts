import { describe, it, expect } from "vitest";
import {
  DISTRICTS,
  DISTRICT_IDS,
  districtById,
  doorwayView,
  facing,
  isDistrictId,
  neighbour,
} from "@/lib/hub/districts";
import { FRAME, FRAME_POINTS, HUB_FOV, clearance, focusBox, focusView, overview, project } from "@/lib/hub/framing";
import {
  BENCHES,
  DOCK,
  FOUNTAIN,
  ISLET_OUTLINE,
  MAIN_OUTLINE,
  PATHS,
  PLAZA,
  PLAZA_LAMPS,
  TREES,
  WATERFRONT_LAMPS,
  doorOf,
  edgeDistance,
  onLand,
  pointInPolygon,
  shoreField,
  smoothClosed,
  type Point,
} from "@/lib/hub/island";
import { GLYPHS } from "@/lib/hub/glyphs";

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("the island's ground plan", () => {
  it("has every building on land, whole, with room to walk around it", () => {
    for (const d of DISTRICTS) {
      const outline = d.id === "settings" ? ISLET_OUTLINE : MAIN_OUTLINE;
      expect(pointInPolygon(d.at, outline), d.id).toBe(true);
      expect(edgeDistance(d.at, outline), d.id).toBeGreaterThan(d.id === "settings" ? d.radius * 0.9 : d.radius + 0.5);
    }
  });

  it("never puts two buildings in each other", () => {
    for (const a of DISTRICTS) {
      for (const b of DISTRICTS) {
        if (a.id >= b.id) continue;
        expect(dist(a.at, b.at), `${a.id} / ${b.id}`).toBeGreaterThan(a.radius + b.radius + 1);
      }
    }
  });

  it("keeps the fountain clear, and only the clock tower on the plaza", () => {
    for (const d of DISTRICTS) {
      expect(dist(d.at, FOUNTAIN.center), d.id).toBeGreaterThan(FOUNTAIN.radius + d.radius + 1.5);
      const onPlaza = dist(d.at, PLAZA.center) < PLAZA.radius + d.radius;
      expect(onPlaza, d.id).toBe(d.id === "today");
    }
  });

  it("turns every door towards the plaza, and the lighthouse out to sea", () => {
    for (const d of DISTRICTS) {
      const f = facing(d);
      const front = [Math.sin(f), Math.cos(f)];
      const toPlaza = [PLAZA.center[0] - d.at[0], PLAZA.center[1] - d.at[1]];
      const len = Math.hypot(toPlaza[0], toPlaza[1]);
      const dot = (front[0] * toPlaza[0] + front[1] * toPlaza[1]) / len;
      if (d.id === "settings") expect(dot).toBeLessThan(-0.9);
      else expect(dot, d.id).toBeGreaterThan(0.9);
    }
  });

  it("leads a path from the plaza to every door, over land", () => {
    expect(PATHS).toHaveLength(DISTRICTS.length - 2);
    for (const p of PATHS) {
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const q: Point = [p.from[0] + (p.to[0] - p.from[0]) * t, p.from[1] + (p.to[1] - p.from[1]) * t];
        expect(onLand(q)).toBe(true);
      }
      expect(DISTRICTS.some((d) => dist(doorOf(d), p.to) < 1e-9)).toBe(true);
    }
  });

  it("stands lamps, trees and benches on land and out of the way", () => {
    for (const lamp of [...PLAZA_LAMPS, ...WATERFRONT_LAMPS]) expect(onLand(lamp), String(lamp)).toBe(true);
    expect(PLAZA_LAMPS.length).toBeGreaterThanOrEqual(6);
    expect(TREES.length).toBeGreaterThan(15);
    for (const t of TREES) {
      expect(onLand(t.at)).toBe(true);
      for (const d of DISTRICTS) expect(dist(t.at, d.at)).toBeGreaterThan(d.radius + 0.5);
    }
    for (const b of BENCHES) expect(dist(b.at, PLAZA.center)).toBeLessThan(PLAZA.radius);
  });

  it("runs the jetty from the plaza out over the water", () => {
    expect(onLand(DOCK.from)).toBe(true);
    expect(pointInPolygon(DOCK.to, MAIN_OUTLINE)).toBe(false);
  });

  it("smooths the coast without loops: every sample stays near the control polygon", () => {
    const smooth = smoothClosed([[0, 0], [4, 0], [4, 4], [0, 4]], 8);
    expect(smooth).toHaveLength(32);
    for (const p of smooth) {
      expect(p[0]).toBeGreaterThan(-0.8);
      expect(p[0]).toBeLessThan(4.8);
    }
  });
});

describe("the water around it", () => {
  it("is shallow at the coast and deep far out", () => {
    const size = 64;
    const extent = 32;
    const field = shoreField(size, extent, 4);
    const sample = (x: number, z: number) => {
      const col = Math.floor(((x + extent) / (extent * 2)) * size);
      const row = Math.floor(((z + extent) / (extent * 2)) * size);
      return field[row * size + col];
    };
    expect(sample(0, 0)).toBe(255);
    expect(sample(0, -31)).toBe(0);
    const near = sample(0, -14);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(255);
  });
});

describe("the camera's views", () => {
  it("frames each building whole in the space its panel leaves, clear of every other and unobstructed", () => {
    for (const aspect of [21 / 9, 16 / 9, 4 / 3, 0.75, 0.5]) {
      const box = focusBox(aspect);
      for (const d of DISTRICTS) {
        const v = focusView(d, aspect);
        expect(clearance(v.position, d).clear, `${d.id} at ${aspect.toFixed(2)}`).toBe(true);
        const r = d.radius * 0.95;
        for (const y of [0, d.height]) {
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const s = project([d.at[0] + sx * r, y, d.at[1] + sz * r], v, aspect, HUB_FOV);
            expect(s.x, `${d.id} x at ${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(box.minX - 0.01);
            expect(s.x).toBeLessThanOrEqual(box.maxX + 0.01);
            expect(s.y, `${d.id} y at ${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(box.minY - 0.01);
            expect(s.y).toBeLessThanOrEqual(box.maxY + 0.01);
          }
        }
        const cam: Point = [v.position[0], v.position[2]];
        for (const o of DISTRICTS) {
          if (o.id === d.id) continue;
          const inside = dist(cam, o.at) < o.radius + 0.6 && v.position[1] < o.height + 0.6;
          expect(inside, `${d.id} camera inside ${o.id}`).toBe(false);
        }
        expect(v.position[1]).toBeGreaterThan(1);
      }
    }
  });

  it("fits the whole island on every screen shape, and not smaller than it must", () => {
    for (const aspect of [21 / 9, 16 / 9, 16 / 10, 4 / 3, 1, 0.75, 0.46]) {
      const v = overview(aspect);
      let maxX = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of FRAME_POINTS) {
        const s = project(p, v, aspect, HUB_FOV);
        expect(s.depth, `behind the camera at ${aspect}`).toBeGreaterThan(0);
        maxX = Math.max(maxX, Math.abs(s.x));
        minY = Math.min(minY, s.y);
        maxY = Math.max(maxY, s.y);
      }
      expect(maxX, `width at ${aspect.toFixed(2)}`).toBeLessThanOrEqual(FRAME.side + 1e-3);
      expect(maxY).toBeLessThanOrEqual(FRAME.top + 0.01);
      expect(minY).toBeGreaterThanOrEqual(FRAME.bottom - 0.01);
      // Tight: it touches the sides, or fills the height it is given.
      const tight = maxX > FRAME.side - 0.02 || maxY - minY > FRAME.top - FRAME.bottom - 0.03;
      expect(tight, `loose framing at ${aspect.toFixed(2)}`).toBe(true);
    }
  });

  it("steps back on a portrait screen", () => {
    expect(overview(0.5).position[2]).toBeGreaterThan(overview(16 / 9).position[2]);
    const d = districtById("brain");
    expect(focusView(d, 16 / 9).position).not.toEqual(focusView(d, 0.5).position);
  });

  it("ends 'enter' in front of the door, looking in", () => {
    for (const d of DISTRICTS) {
      const v = doorwayView(d);
      expect(dist([v.position[0], v.position[2]], doorOf(d))).toBeLessThan(1.5);
      expect(dist([v.target[0], v.target[2]], d.at)).toBeLessThan(dist([v.position[0], v.position[2]], d.at));
    }
  });
});

describe("the registry", () => {
  it("visits every building in turn with the arrows, both ways", () => {
    let id = DISTRICT_IDS[0];
    const seen = new Set<string>();
    for (let i = 0; i < DISTRICT_IDS.length; i++) {
      seen.add(id);
      id = neighbour(id, 1);
    }
    expect(seen.size).toBe(DISTRICT_IDS.length);
    expect(neighbour(neighbour("brain", 1), -1)).toBe("brain");
    expect(isDistrictId("brain")).toBe(true);
    expect(isDistrictId("../admin")).toBe(false);
  });

  it("has a sign pictogram for every building, and every route is an app page", () => {
    for (const d of DISTRICTS) {
      expect(GLYPHS[d.id].length).toBeGreaterThan(0);
      expect(d.href).toMatch(/^\/[a-z]+$/);
    }
  });
});
