import { describe, it, expect } from "vitest";
import { BODY, footDrop, footReach, gaitPose, sitPose, standPose, strideLength } from "@/lib/hub/gait";

describe("the gait", () => {
  it("always has a foot on the ground and none below it, walking or running", () => {
    for (const run of [0, 0.5, 1]) {
      for (let p = 0; p < 2; p += 0.01) {
        const pose = gaitPose(p, run);
        const left = pose.hipHeight - footDrop(pose.hip[0], pose.knee[0]);
        const right = pose.hipHeight - footDrop(pose.hip[1], pose.knee[1]);
        expect(Math.min(left, right)).toBeCloseTo(0, 9);
        expect(left).toBeGreaterThanOrEqual(-1e-9);
        expect(right).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it("repeats every stride, with the legs in antiphase and each arm with the other leg", () => {
    const a = gaitPose(0.13);
    const b = gaitPose(1.13);
    expect(a.hip[0]).toBeCloseTo(b.hip[0], 9);
    expect(a.knee[1]).toBeCloseTo(b.knee[1], 9);
    const half = gaitPose(0.63);
    expect(half.hip[1]).toBeCloseTo(a.hip[0], 9);
    // Left leg forward → left arm back.
    const forward = gaitPose(0.25);
    expect(forward.hip[0]).toBeGreaterThan(0);
    expect(forward.shoulder[0]).toBeLessThan(0);
  });

  it("bends the knees more and leans further when running", () => {
    const maxKnee = (run: number) => Math.max(...Array.from({ length: 100 }, (_, i) => gaitPose(i / 100, run).knee[0]));
    expect(maxKnee(1)).toBeGreaterThan(maxKnee(0) * 1.6);
    expect(gaitPose(0, 1).lean).toBeGreaterThan(gaitPose(0, 0).lean);
    expect(strideLength(1)).toBeGreaterThan(strideLength(0));
  });

  it("never bends a knee the wrong way", () => {
    for (let p = 0; p < 1; p += 0.01) for (const k of gaitPose(p, 0.7).knee) expect(k).toBeGreaterThanOrEqual(0);
  });

  it("puts the feet down about where a stride's length says", () => {
    // Over a stride, the foot's reach swings roughly ±¼ stride around the hip.
    const reaches = Array.from({ length: 100 }, (_, i) => {
      const pose = gaitPose(i / 100, 0);
      return footReach(pose.hip[0], pose.knee[0]);
    });
    const span = Math.max(...reaches) - Math.min(...reaches);
    expect(span).toBeGreaterThan(strideLength(0) * 0.4);
    expect(span).toBeLessThan(strideLength(0) * 1.2);
  });
});

describe("standing and sitting", () => {
  it("stands on the ground, shifting weight without floating", () => {
    for (let t = 0; t < 30; t += 0.1) {
      const pose = standPose(t, 3);
      const feet = [0, 1].map((i) => pose.hipHeight - footDrop(pose.hip[i], pose.knee[i]));
      expect(Math.min(...feet)).toBeLessThan(0.003);
      expect(Math.min(...feet)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("lifts a hand now and then while talking", () => {
    const lifted = Array.from({ length: 300 }, (_, i) => standPose(i * 0.1, 5).shoulder[0]).filter((s) => s > 0.5).length;
    expect(lifted).toBeGreaterThan(0);
    expect(lifted).toBeLessThan(150);
  });

  it("sits on its seat with thighs level", () => {
    const pose = sitPose(1, 2, 0.16);
    expect(pose.hipHeight).toBeCloseTo(0.172, 3);
    for (const h of pose.hip) expect(Math.abs(h - Math.PI / 2)).toBeLessThan(0.25);
    // The shins hang down from the knees.
    for (let i = 0; i < 2; i++) expect(Math.abs(pose.hip[i] - pose.knee[i])).toBeLessThan(0.3);
  });

  it("builds a person of the island's height", () => {
    const standing = footDrop(0, 0) + BODY.torso + BODY.headRadius * 2 + 0.02;
    expect(standing).toBeGreaterThan(0.42);
    expect(standing).toBeLessThan(0.5);
  });
});
