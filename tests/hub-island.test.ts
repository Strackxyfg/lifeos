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
import {
  FRAME,
  FRAME_POINTS,
  HUB_FOV,
  PORTRAIT_LENS,
  clearance,
  focusBox,
  focusView,
  freeArea,
  lensFor,
  overview,
  overviewBand,
  project,
} from "@/lib/hub/framing";
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

  it("is, byte for byte, what asking every point one by one gives — only faster", () => {
    // The field as it was first written: every point, every edge.
    const reference = (size: number, extent: number, reach: number) => {
      const out = new Uint8Array(size * size);
      const polys = [MAIN_OUTLINE, ISLET_OUTLINE];
      const all = polys.flat();
      const minX = Math.min(...all.map((p) => p[0])) - reach;
      const maxX = Math.max(...all.map((p) => p[0])) + reach;
      const minZ = Math.min(...all.map((p) => p[1])) - reach;
      const maxZ = Math.max(...all.map((p) => p[1])) + reach;
      for (let row = 0; row < size; row++) {
        const z = -extent + ((row + 0.5) / size) * extent * 2;
        for (let col = 0; col < size; col++) {
          const x = -extent + ((col + 0.5) / size) * extent * 2;
          if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
          const p: Point = [x, z];
          const v = polys.some((poly) => pointInPolygon(p, poly))
            ? 1
            : Math.max(0, 1 - Math.min(...polys.map((poly) => edgeDistance(p, poly))) / reach);
          out[row * size + col] = Math.round(v * 255);
        }
      }
      return out;
    };
    // The sea's (224, 36, 5), the photo's (288, 36, 5), and others: coarse, fine, a short and a long reach.
    for (const [size, extent, reach] of [[224, 36, 5], [288, 36, 5], [64, 32, 4], [97, 20, 0.5], [150, 40, 12]]) {
      const fast = shoreField(size, extent, reach);
      const slow = reference(size, extent, reach);
      let differ = 0;
      for (let i = 0; i < fast.length; i++) if (fast[i] !== slow[i]) differ++;
      expect(differ, `${size} ${extent} ${reach}`).toBe(0);
    }
  });
});

describe("the camera's views", () => {
  it("frames each building whole in the space its panel leaves, clear of every other and unobstructed", () => {
    for (const aspect of [21 / 9, 16 / 9, 4 / 3, 0.75, 0.5, 0.46]) {
      const box = focusBox(aspect);
      for (const d of DISTRICTS) {
        const v = focusView(d, aspect);
        expect(clearance(v.position, d).clear, `${d.id} at ${aspect.toFixed(2)}`).toBe(true);
        const r = d.radius * 0.95;
        for (const y of [0, d.height]) {
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const s = project([d.at[0] + sx * r, y, d.at[1] + sz * r], v, aspect, lensFor(aspect).fov);
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
        const s = project(p, v, aspect, lensFor(aspect).fov);
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

  it("widens and steepens its lens for a phone held upright, and only then", () => {
    // Landscape and square-ish desktops keep the lens the island was designed with.
    for (const aspect of [21 / 9, 16 / 9, 4 / 3, 1]) {
      expect(lensFor(aspect).fov).toBeCloseTo(HUB_FOV, 6);
      expect(lensFor(aspect).pitch).toBeCloseTo((32 * Math.PI) / 180, 6);
    }
    expect(lensFor(0.46)).toEqual(PORTRAIT_LENS);
    expect(lensFor(0.3)).toEqual(PORTRAIT_LENS);
    // In between, a smooth blend that never goes backwards.
    let last = lensFor(1);
    for (let a = 0.98; a >= 0.5; a -= 0.02) {
      const l = lensFor(a);
      expect(l.fov).toBeGreaterThanOrEqual(last.fov);
      expect(l.pitch).toBeGreaterThanOrEqual(last.pitch);
      last = l;
    }
    // Upright, the island fills more of the height: its markers spread apart
    // (measured: 14 % more, from 130 to 148 px on a 375 × 812 phone).
    const spread = (aspect: number, lens = lensFor(aspect)) => {
      const v = overview(aspect, lens);
      const ys = DISTRICTS.map((d) => project([d.at[0], d.height + 1.15, d.at[1]], v, aspect, lens.fov).y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread(0.46)).toBeGreaterThan(spread(0.46, { fov: HUB_FOV, pitch: (32 * Math.PI) / 180 }) * 1.1);
  });

  it("frames a building above a phone's sheet, as measured", () => {
    const aspect = 375 / 812;
    // A sheet whose top is at 386 px, the heads-up display down to 60 px.
    const free = freeArea({ width: 375, height: 812 }, 60, { top: 386, left: 12, width: 351, height: 414 });
    expect(free.maxX - free.minX).toBe(2);
    expect(free.minY).toBeCloseTo(1 - (2 * 386) / 812, 6);
    expect(free.maxY).toBeCloseTo(1 - (2 * 60) / 812, 6);
    const box = focusBox(aspect, free);
    expect(box.minY).toBeGreaterThan(free.minY);
    expect(box.maxY).toBeLessThan(free.maxY);
    for (const d of DISTRICTS) {
      const v = focusView(d, aspect, lensFor(aspect), box);
      const r = d.radius * 0.95;
      for (const y of [0, d.height]) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const s = project([d.at[0] + sx * r, y, d.at[1] + sz * r], v, aspect, lensFor(aspect).fov);
          // Above the sheet and below the bar: nothing of it behind the panel.
          expect(s.y, `${d.id}`).toBeGreaterThanOrEqual(free.minY);
          expect(s.y, `${d.id}`).toBeLessThanOrEqual(free.maxY);
        }
      }
    }
  });

  it("keeps a building a minimum share of a small phone, and narrows the usual place beside a side panel", () => {
    // A sheet covering 70 % of the screen: the box keeps half the height.
    const tall = focusBox(0.56, freeArea({ width: 320, height: 568 }, 60, { top: 170, left: 12, width: 296, height: 386 }));
    expect(tall.maxY - tall.minY).toBeCloseTo(0.5, 6);
    // A side panel reaching into the usual place: narrowed, never widened.
    const usual = focusBox(16 / 9);
    const side = focusBox(16 / 9, freeArea({ width: 900, height: 506 }, 120, { top: 80, left: 516, width: 368, height: 300 }));
    expect(side.maxX).toBeLessThan(usual.maxX);
    expect(side.minX).toBeGreaterThanOrEqual(usual.minX);
    // A wide screen with room to spare: exactly the usual place.
    const roomy = focusBox(16 / 9, freeArea({ width: 1920, height: 1080 }, 130, { top: 80, left: 1536, width: 368, height: 500 }));
    expect(roomy).toEqual(usual);
  });

  it("narrows the island's band only where the bar and the cards reach into it", () => {
    // A tall phone: the usual band, the sky keeps its room.
    expect(overviewBand({ height: 812 }, 52, 691)).toEqual({ top: FRAME.top, bottom: FRAME.bottom });
    // A phone on its side: below the bar and its markers, above the cards.
    const band = overviewBand({ height: 375 }, 62, 300);
    expect(band.top).toBeCloseTo(1 - (2 * (62 + 34)) / 375, 6);
    expect(band.bottom).toBeCloseTo(1 - (2 * (300 - 6)) / 375, 6);
    const v = overview(812 / 375, lensFor(812 / 375), band);
    for (const p of FRAME_POINTS) {
      const s = project(p, v, 812 / 375, lensFor(812 / 375).fov);
      expect(s.y).toBeLessThanOrEqual(band.top + 0.01);
      expect(s.y).toBeGreaterThanOrEqual(band.bottom - 0.01);
    }
    // No room at all: a minimum band rather than nothing.
    const squeezed = overviewBand({ height: 200 }, 80, 110);
    expect(squeezed.top - squeezed.bottom).toBeCloseTo(0.5, 6);
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
