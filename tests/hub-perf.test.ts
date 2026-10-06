import { describe, it, expect } from "vitest";
import { effectiveDpr, Governor, initialTier, LADDER, nextLevel, TIERS } from "@/lib/hub/perf";

describe("the first guess", () => {
  it("starts strong machines high, phones and small machines medium, the weakest low", () => {
    expect(initialTier({ cores: 8, memory: 8, width: 1850 })).toBe("high");
    expect(initialTier({ cores: 8, memory: 8, coarse: true })).toBe("medium");
    expect(initialTier({ cores: 4, memory: 8 })).toBe("medium");
    expect(initialTier({ cores: 2 })).toBe("low");
    expect(initialTier({ cores: 16, saveData: true })).toBe("low");
    // No float render targets (some older phones): the direct path, never a black island.
    expect(initialTier({ cores: 8, memory: 8, coarse: true, floatTargets: false })).toBe("low");
    expect(initialTier({ cores: 8, memory: 8, width: 1850, floatTargets: true })).toBe("high");
  });

  it("only the weakest tier draws without the post pipeline", () => {
    expect(TIERS.high.startLevel).toBe(0);
    expect(TIERS.medium.startLevel).not.toBeNull();
    expect(TIERS.low.startLevel).toBeNull();
  });
});

describe("the ladder", () => {
  it("never draws fewer pixels than CSS pixels (that is what looked pixelated)", () => {
    for (const l of LADDER) {
      expect(effectiveDpr(l, 1, 2)).toBe(1);
      expect(effectiveDpr(l, 1.25, 2)).toBeGreaterThanOrEqual(1);
      expect(effectiveDpr(l, 2, 2)).toBeGreaterThanOrEqual(1);
    }
    // A sharp screen gives up some of its sharpness first; a browser zoomed out keeps its own ratio.
    expect(effectiveDpr(LADDER[1], 2, 2)).toBeCloseTo(1.7);
    expect(effectiveDpr(LADDER[0], 0.8, 2)).toBeCloseTo(0.8);
  });

  it("never switches off what makes the island itself: bloom, grade and antialiasing stay on every rung", () => {
    for (const l of LADDER) expect(l.msaa).toBeGreaterThanOrEqual(2);
  });

  it("skips rungs that would change nothing on this screen", () => {
    // On a 1× screen the resolution steps do nothing: straight to fewer samples.
    expect(nextLevel(0, 1, 2)).toBe(2);
    // On a 2× screen, resolution first.
    expect(nextLevel(0, 2, 2)).toBe(1);
    expect(nextLevel(LADDER.length - 1, 1, 2)).toBeNull();
  });
});

describe("the governor", () => {
  const feed = (g: Governor, from: number, frames: number, interval: number, target: number) => {
    let stepped = false;
    let t = from;
    for (let i = 0; i < frames; i++) {
      t += interval;
      if (g.sample(t, { interval, target })) stepped = true;
    }
    return { stepped, t };
  };

  it("stays quiet while shaders compile, then steps down only on sustained slowness", () => {
    const g = new Governor(0);
    // Slow frames during the warm-up say nothing.
    expect(feed(g, 0, 100, 40, 1000 / 60).stepped).toBe(false);
    // On time: nothing.
    const g2 = new Governor(0);
    expect(feed(g2, 6000, 200, 1000 / 60, 1000 / 60).stepped).toBe(false);
    // Aiming at 60 and getting 30: kept — quality is worth more than those frames.
    expect(feed(g2, 10000, 90, 1000 / 30, 1000 / 60).stepped).toBe(false);
    // Aiming at 60 and getting 15, for long enough: step.
    expect(feed(g2, 12000, 45, 1000 / 15, 1000 / 60).stepped).toBe(true);
  });

  it("does not step for a few hitches, nor for a stall (a tab coming back)", () => {
    const g = new Governor(0);
    let t = 6000;
    let stepped = false;
    for (let i = 0; i < 90; i++) {
      t += 16.7;
      const interval = i % 10 === 0 ? 60 : 16.7;
      stepped ||= g.sample(t, { interval, target: 1000 / 60 });
    }
    expect(stepped).toBe(false);
    expect(g.sample(t + 5000, { interval: 5000, target: 1000 / 60 })).toBe(false);
  });

  it("holds after a step, so the new rung is judged on its own frames", () => {
    const g = new Governor(0);
    const first = feed(g, 6000, 45, 70, 1000 / 60);
    expect(first.stepped).toBe(true);
    g.stepped(first.t);
    expect(feed(g, first.t, 50, 70, 1000 / 60).stepped).toBe(false); // within the 4 s hold
  });

  it("judges an idle island against its own, lower aim", () => {
    const g = new Governor(0);
    // 30 fps aimed, 30 fps delivered: fine.
    expect(feed(g, 6000, 60, 1000 / 30, 1000 / 30).stepped).toBe(false);
    // 30 aimed, 15 delivered: too slow.
    expect(feed(g, 9000, 45, 1000 / 15, 1000 / 30).stepped).toBe(true);
  });
});
