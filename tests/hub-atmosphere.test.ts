import { describe, it, expect } from "vitest";
import {
  ambientSky,
  atmoLight,
  atmosphereGLSL,
  exposureFor,
  luminance,
  MAX_EXPOSURE,
  miePhase,
  moonIrradiance,
  rayleighPhase,
  REFERENCE_ILLUMINANCE,
  skyIrradiance,
  skyRadiance,
  sunlight,
  transmittance,
  twilight,
  type Vec3,
} from "@/lib/hub/atmosphere";

const dir = (elDeg: number, azDeg = 0): Vec3 => {
  const e = (elDeg * Math.PI) / 180;
  const a = (azDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
};

/** Integrate a phase function over the sphere: it must be 1. */
function sphereIntegral(p: (c: number) => number): number {
  const n = 4000;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const c = -1 + (2 * (i + 0.5)) / n;
    s += p(c) * (2 / n) * 2 * Math.PI;
  }
  return s;
}

describe("the air", () => {
  it("has phase functions that conserve energy, the aerosols' strongly forward", () => {
    expect(sphereIntegral(rayleighPhase)).toBeCloseTo(1, 3);
    expect(sphereIntegral((c) => miePhase(c))).toBeCloseTo(1, 2);
    expect(miePhase(1)).toBeGreaterThan(50 * miePhase(0));
  });

  it("lets through more red than blue, far less near the horizon, and nothing through the Earth", () => {
    const up = transmittance(60, 1);
    expect(up[0]).toBeGreaterThan(up[2]);
    // Straight up, most light gets through; the blue loses a quarter (Rayleigh + haze + ozone).
    expect(up[0]).toBeGreaterThan(0.88);
    expect(up[2]).toBeGreaterThan(0.65);
    const low = transmittance(60, Math.sin((1 * Math.PI) / 180));
    expect(low[2]).toBeLessThan(up[2] / 5);
    expect(transmittance(60, -0.2)).toEqual([0, 0, 0]);
  });
});

describe("the sun that reaches the island", () => {
  it("is nearly white at noon, golden low, red at the horizon, gone below it", () => {
    const noon = sunlight(60);
    expect(noon[2] / noon[0]).toBeGreaterThan(0.7);
    const low = sunlight(6);
    expect(low[2] / low[0]).toBeLessThan(0.3);
    const setting = sunlight(0.5);
    expect(setting[2] / setting[0]).toBeLessThan(0.05);
    expect(luminance(setting)).toBeLessThan(luminance(noon) / 5);
    expect(sunlight(-1)).toEqual([0, 0, 0]);
  });

  it("weakens continuously as the sun sinks, without a step at the horizon", () => {
    let prev = luminance(sunlight(20));
    for (let e = 19.9; e >= -1; e -= 0.1) {
      const l = luminance(sunlight(e));
      expect(l).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - l, `at ${e.toFixed(1)}°`).toBeLessThan(0.08);
      prev = l;
    }
  });
});

describe("the sky", () => {
  it("is blue overhead at noon and pale at the horizon", () => {
    const sun = dir(55, 180);
    const zenith = skyRadiance([0, 1, 0], sun);
    const horizon = skyRadiance(dir(2, 0), sun);
    expect(zenith[2]).toBeGreaterThan(zenith[0] * 2.5);
    expect(luminance(horizon)).toBeGreaterThan(luminance(zenith) * 2);
    // Paler: the horizon's blue-to-red ratio is far lower than the zenith's.
    expect(horizon[2] / horizon[0]).toBeLessThan(zenith[2] / zenith[0] / 2);
  });

  it("glows orange towards a setting sun and stays blue-grey away from it", () => {
    const sun = dir(2, 270);
    const toward = skyRadiance(dir(3, 270), sun);
    const away = skyRadiance(dir(3, 90), sun);
    expect(toward[0]).toBeGreaterThan(toward[2] * 5);
    expect(luminance(toward)).toBeGreaterThan(luminance(away) * 3);
  });

  it("is brightest around the sun (the aerosols' glare)", () => {
    const sun = dir(30, 180);
    const near = skyRadiance(dir(32, 180), sun);
    const far = skyRadiance(dir(32, 0), sun);
    expect(luminance(near)).toBeGreaterThan(luminance(far) * 3);
  });

  it("gives a realistic share of diffuse light at noon: about a tenth of the total", () => {
    const e = 60;
    const sky = luminance(skyIrradiance(dir(e, 180)));
    const direct = luminance(sunlight(e)) * Math.sin((e * Math.PI) / 180);
    const share = sky / (sky + direct);
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.25);
  });
});

describe("twilight and night", () => {
  it("keeps a blue glow after sunset that fades to the night's by astronomical dusk", () => {
    const t0 = twilight(-0.5);
    const t6 = twilight(-6);
    expect(t0.zenith[2]).toBeGreaterThan(t0.zenith[0]);
    expect(luminance(t6.zenith)).toBeLessThan(luminance(t0.zenith) / 5);
    expect(twilight(-18).zenith).toEqual([0, 0, 0]);
    // Continuous at the horizon and at the end.
    expect(luminance(twilight(0.01).zenith)).toBeCloseTo(luminance(twilight(-0.01).zenith), 4);
    expect(luminance(twilight(-17.99).zenith)).toBeLessThan(1e-5);
  });

  it("never lets the sky go black: the night keeps its own glow", () => {
    const night = ambientSky(-40);
    expect(luminance(night.zenith)).toBeGreaterThan(0.002);
    expect(night.zenith[2]).toBeGreaterThan(night.zenith[0]);
  });

  it("gives the moon less than half the light at half phase", () => {
    expect(moonIrradiance(0.5)).toBeLessThan(moonIrradiance(1) * 0.4);
    expect(moonIrradiance(0)).toBe(0);
  });
});

describe("exposure", () => {
  it("is neutral at the reference light, opens up for less, within its limits", () => {
    expect(exposureFor(REFERENCE_ILLUMINANCE)).toBeCloseTo(0, 5);
    expect(exposureFor(REFERENCE_ILLUMINANCE / 4)).toBeGreaterThan(0.9);
    expect(exposureFor(1e-5)).toBe(MAX_EXPOSURE);
    expect(exposureFor(1e6)).toBeGreaterThanOrEqual(-0.4);
  });

  it("follows the day: noon near zero, golden hour opened up, night at its longest", () => {
    const at = (e: number, moonE = -30) => atmoLight(e, dir(e, 180), moonE, dir(moonE, 0), 0.5, e < -4 ? 1 : 0);
    const noon = at(60);
    const golden = at(6);
    const night = at(-30);
    expect(Math.abs(noon.exposure)).toBeLessThan(0.3);
    expect(golden.exposure).toBeGreaterThan(noon.exposure + 1);
    expect(night.exposure).toBe(MAX_EXPOSURE);
    // Night: the city's warm glow reaches the ground the walls see.
    expect(night.ground[0]).toBeGreaterThan(night.ground[2]);
  });

  it("changes smoothly minute by minute through sunset", () => {
    let prev = atmoLight(10, dir(10, 270), -30, dir(-30, 0), 0).exposure;
    for (let e = 9.9; e >= -10; e -= 0.1) {
      const x = atmoLight(e, dir(e, 270), -30, dir(-30, 0), 0).exposure;
      expect(Math.abs(x - prev), `at ${e.toFixed(1)}°`).toBeLessThan(0.1);
      prev = x;
    }
  });
});

describe("the shader", () => {
  it("is generated from the same constants, as valid float literals", () => {
    const glsl = atmosphereGLSL();
    expect(glsl).toContain("vec3 skyRadiance(vec3 view, vec3 light, float irradiance)");
    expect(glsl).toContain("const float EARTH_R = 6360000.0;");
    // No bare integers where GLSL wants floats.
    for (const m of glsl.matchAll(/const float \w+ = ([^;]+);/g)) expect(m[1]).toMatch(/[.e]/);
  });
});
