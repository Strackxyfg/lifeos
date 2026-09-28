import { describe, it, expect } from "vitest";
import { D65_XY, apply, daylightXY, gradeFor, whiteBalance } from "@/lib/hub/grade";
import { skyState } from "@/lib/hub/sky";

const sun = (elevation: number, rising = false) => ({ elevation, azimuth: 200, rising, hourAngle: rising ? -60 : 60 });

describe("white balance", () => {
  it("follows the CIE daylight locus: D65 exactly at 6504 K, D50 at 5003 K, bluish at 10000 K", () => {
    const [x, y] = daylightXY(6504);
    expect(Math.abs(x - D65_XY[0])).toBeLessThan(0.0005);
    expect(Math.abs(y - D65_XY[1])).toBeLessThan(0.0005);
    // D50, the printing industry's white: x 0.3457, y 0.3585.
    const [x50, y50] = daylightXY(5003);
    expect(Math.abs(x50 - 0.3457)).toBeLessThan(0.001);
    expect(Math.abs(y50 - 0.3585)).toBeLessThan(0.001);
    expect(daylightXY(10_000)[0]).toBeLessThan(0.29);
  });

  it("leaves white alone at D65 and keeps white's luminance when it warms or cools", () => {
    const neutral = apply(whiteBalance(6504), [1, 1, 1]);
    for (const c of neutral) expect(Math.abs(c - 1)).toBeLessThan(0.003);
    for (const k of [5000, 8000]) {
      const [r, g, b] = apply(whiteBalance(k), [1, 1, 1]);
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(y).toBeCloseTo(1, 1);
    }
  });

  it("warms the picture for a bluer source light, cools it for a redder one", () => {
    const [rw, , bw] = apply(whiteBalance(8000), [1, 1, 1]);
    expect(rw).toBeGreaterThan(bw);
    const [rc, , bc] = apply(whiteBalance(5000), [1, 1, 1]);
    expect(bc).toBeGreaterThan(rc);
  });
});

describe("the grade of the moment", () => {
  it("balances for the noon sun, keeps the low sun golden, and the night cool", () => {
    const noon = gradeFor(skyState(sun(40)), 40);
    const golden = gradeFor(skyState(sun(5)), 5);
    const night = gradeFor(skyState(sun(-25)), -25);
    // A camera's daylight balance, the sun's ~5600 K with the sky's fill.
    expect(noon.whiteBalanceK).toBeGreaterThan(5700);
    expect(noon.whiteBalanceK).toBeLessThan(6100);
    // Less correction at golden hour than at noon: the gold stays (the
    // lamps coming on already pull it back a little).
    expect(golden.whiteBalanceK).toBeGreaterThan(noon.whiteBalanceK + 100);
    // Night is balanced towards the lamps' warmth — the sky turns blue.
    expect(night.whiteBalanceK).toBeLessThan(5000);
    expect(night.bloomStrength).toBeGreaterThan(noon.bloomStrength);
    expect(golden.saturation).toBeGreaterThan(noon.saturation);
    expect(night.shadowTint[2]).toBeGreaterThan(night.shadowTint[0]);
  });

  it("passes the metered exposure through untouched", () => {
    expect(gradeFor(skyState(sun(40)), 40, 0).exposure).toBe(0);
    expect(gradeFor(skyState(sun(-25)), -25, 2.6).exposure).toBe(2.6);
  });

  it("never jumps from one moment to the next", () => {
    let prev = gradeFor(skyState(sun(60)), 60);
    for (let e = 59.9; e >= -30; e -= 0.1) {
      const g = gradeFor(skyState(sun(e)), e);
      expect(Math.abs(g.exposure - prev.exposure), `exposure at ${e.toFixed(1)}`).toBeLessThan(0.02);
      expect(Math.abs(g.whiteBalanceK - prev.whiteBalanceK), `WB at ${e.toFixed(1)}`).toBeLessThan(40);
      expect(Math.abs(g.bloomStrength - prev.bloomStrength)).toBeLessThan(0.02);
      prev = g;
    }
  });
});
