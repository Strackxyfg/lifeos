import type { Rgb } from "./sky";

/**
 * The island's air: sunlight and skylight from the physics of scattering.
 *
 * A painted gradient can be pretty; it cannot be right at every minute of the
 * day, and the eye knows. This is the model renderers use: sunlight crossing
 * a spherical atmosphere of air molecules (Rayleigh — the blue of the sky, the
 * red of a low sun), aerosols (Mie — the white haze of the horizon and the
 * glare around the sun) and ozone (whose absorption keeps the zenith blue at
 * twilight). Single scattering, integrated numerically.
 *
 * From one set of constants come, consistently: the colour and strength of
 * the sun that reaches the ground, the sky's radiance in every direction (the
 * sky dome, the reflections, the ambient light — `scene/atmosphere.tsx` runs
 * the same integral in a shader), and how much light falls on the island,
 * which sets the exposure. Pure: tested against what the sky does.
 *
 * Units: metres for the atmosphere; light in the scene's own units, where
 * the sun above the atmosphere gives `SUN_IRRADIANCE`.
 */

export const EARTH_RADIUS = 6_360_000;
export const ATMOSPHERE_TOP = 6_420_000;
/** The observer stands on a low coast. */
export const OBSERVER_HEIGHT = 60;

/** Rayleigh scattering at sea level, per metre (Hillaire 2020). */
export const RAYLEIGH: Rgb = [5.802e-6, 13.558e-6, 33.1e-6];
export const RAYLEIGH_HEIGHT = 8_000;
/** A coastal haze: about twice the aerosols of clean continental air. */
export const HAZE = 2.2;
export const MIE_SCATTERING = 3.996e-6 * HAZE;
export const MIE_EXTINCTION = 4.44e-6 * HAZE;
export const MIE_HEIGHT = 1_200;
/** Aerosols scatter mostly forward: the glare around the sun. */
export const MIE_G = 0.78;
/** Ozone absorption at its peak, per metre, and its layer. */
export const OZONE: Rgb = [0.65e-6, 1.881e-6, 0.085e-6];
export const OZONE_CENTER = 25_000;
export const OZONE_WIDTH = 15_000;

/**
 * Light scattered more than once, as an isotropic share of the single
 * scattering (a fraction of the Rayleigh phase's average). Single scattering
 * alone leaves the sky two to three times too dark next to the sun.
 */
export const MULTIPLE_SCATTERING = 1.1;

/** Sunlight above the atmosphere, in scene units (white by definition: the grade balances it). */
export const SUN_IRRADIANCE = 5.4;
/** The sun's angular radius, in radians. */
export const SUN_RADIUS = 0.004_65;

export type Vec3 = readonly [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Density {
  rayleigh: number;
  mie: number;
  ozone: number;
}

export function density(height: number): Density {
  const h = Math.max(0, height);
  return {
    rayleigh: Math.exp(-h / RAYLEIGH_HEIGHT),
    mie: Math.exp(-h / MIE_HEIGHT),
    ozone: Math.max(0, 1 - Math.abs(h - OZONE_CENTER) / OZONE_WIDTH),
  };
}

function extinction(d: Density, c: 0 | 1 | 2): number {
  return RAYLEIGH[c] * d.rayleigh + MIE_EXTINCTION * d.mie + OZONE[c] * d.ozone;
}

/**
 * Distance along a ray from radius `r` with zenith cosine `mu` to where it
 * leaves the atmosphere, or to where it meets the ground (then `ground`).
 */
export function rayLength(r: number, mu: number): { length: number; ground: boolean } {
  const discGround = r * r * (mu * mu - 1) + EARTH_RADIUS * EARTH_RADIUS;
  if (mu < 0 && discGround >= 0) {
    return { length: Math.max(0, -r * mu - Math.sqrt(discGround)), ground: true };
  }
  const discTop = r * r * (mu * mu - 1) + ATMOSPHERE_TOP * ATMOSPHERE_TOP;
  return { length: Math.max(0, -r * mu + Math.sqrt(Math.max(0, discTop))), ground: false };
}

/**
 * The fraction of light that crosses the atmosphere from a point at `height`
 * towards a direction of zenith cosine `mu` — 0 where the Earth is in the way.
 * Samples are packed near the start of the ray (t ∝ u²), where the air is
 * densest.
 */
export function transmittance(height: number, mu: number, steps = 40): Rgb {
  const r = EARTH_RADIUS + height;
  const ray = rayLength(r, mu);
  if (ray.ground) return [0, 0, 0];
  const tau = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    const t = ray.length * u * u;
    const ds = (2 * ray.length * u) / steps;
    const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - EARTH_RADIUS;
    const d = density(h);
    tau[0] += extinction(d, 0) * ds;
    tau[1] += extinction(d, 1) * ds;
    tau[2] += extinction(d, 2) * ds;
  }
  return [Math.exp(-tau[0]), Math.exp(-tau[1]), Math.exp(-tau[2])];
}

/**
 * The sunlight that reaches the island: its colour and strength for this
 * elevation (degrees). Fades as the disc sinks under the horizon, rather
 * than switching off at its centre.
 */
export function sunlight(elevationDeg: number): Rgb {
  const e = (elevationDeg * Math.PI) / 180;
  // The disc's visible fraction, from its upper edge to its lower one.
  const visible = smooth(-SUN_RADIUS, SUN_RADIUS, e);
  if (visible <= 0) return [0, 0, 0];
  const t = transmittance(OBSERVER_HEIGHT, Math.sin(Math.max(e, 0.0005)));
  return [t[0] * SUN_IRRADIANCE * visible, t[1] * SUN_IRRADIANCE * visible, t[2] * SUN_IRRADIANCE * visible];
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/** Cornette–Shanks: Henyey–Greenstein, corrected to match Mie theory better. */
export function miePhase(cosTheta: number, g = MIE_G): number {
  const g2 = g * g;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + cosTheta * cosTheta))) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5));
}

/**
 * The sky's radiance seen in direction `view` (unit, y up) with the sun (or
 * moon) in direction `light`, of irradiance `irradiance` above the air.
 * Single scattering: every point of the ray, lit by what reaches it through
 * the air, scatters towards the eye what the air in between lets through.
 */
export function skyRadiance(view: Vec3, light: Vec3, irradiance = SUN_IRRADIANCE, steps = 32, lightSteps = 16): Rgb {
  const r0 = EARTH_RADIUS + OBSERVER_HEIGHT;
  const ray = rayLength(r0, view[1]);
  const cosTheta = dot(view, light);
  const iso = MULTIPLE_SCATTERING / (4 * Math.PI);
  const pr = rayleighPhase(cosTheta) + iso;
  const pm = miePhase(cosTheta) + iso;
  const out = [0, 0, 0];
  // Optical depth from the eye to the start of the current segment.
  const tau = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    const t = ray.length * u * u;
    const ds = (2 * ray.length * u) / steps;
    // The point, in a frame whose origin is the Earth's centre.
    const px = view[0] * t;
    const py = r0 + view[1] * t;
    const pz = view[2] * t;
    const pr0 = Math.hypot(px, py, pz);
    const h = pr0 - EARTH_RADIUS;
    const d = density(h);
    const muLight = (px * light[0] + py * light[1] + pz * light[2]) / pr0;
    const sun = transmittance(h, muLight, lightSteps);
    for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
      const ext = extinction(d, c);
      const scatter = RAYLEIGH[c] * d.rayleigh * pr + MIE_SCATTERING * d.mie * pm;
      // Seen through the air up to the middle of this segment.
      out[c] += Math.exp(-(tau[c] + ext * ds * 0.5)) * sun[c] * scatter * ds;
      tau[c] += ext * ds;
    }
  }
  return [out[0] * irradiance, out[1] * irradiance, out[2] * irradiance];
}

/**
 * Skylight on a horizontal surface — the sky's radiance, integrated over the
 * hemisphere with the cosine. Quadrature in elevation (midpoints of equal
 * steps of sin²) and azimuth: enough for exposure, not for the picture.
 */
export function skyIrradiance(light: Vec3, irradiance = SUN_IRRADIANCE, rings = 6, sectors = 12): Rgb {
  const out = [0, 0, 0];
  for (let i = 0; i < rings; i++) {
    // Equal steps of sin²(elevation) make the cosine weight uniform.
    const s2a = i / rings;
    const s2b = (i + 1) / rings;
    const sinE = Math.sqrt((s2a + s2b) / 2);
    const cosE = Math.sqrt(1 - sinE * sinE);
    for (let j = 0; j < sectors; j++) {
      const a = ((j + 0.5) / sectors) * Math.PI * 2;
      const v: Vec3 = [cosE * Math.cos(a), sinE, cosE * Math.sin(a)];
      const L = skyRadiance(v, light, irradiance, 16, 8);
      // ∫ L cosθ dω over the hemisphere = π · mean of L under this sampling.
      out[0] += L[0];
      out[1] += L[1];
      out[2] += L[2];
    }
  }
  const k = Math.PI / (rings * sectors);
  return [out[0] * k, out[1] * k, out[2] * k];
}

/** Relative luminance (Rec. 709 primaries, linear). */
export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * The night sky's own light, which no scattering of the sun explains:
 * airglow, starlight, and the glow of the coast's towns on the haze (warmer,
 * low on the horizon). In scene units, tuned so a moonless night is dark
 * blue, not black.
 */
export const NIGHT_ZENITH: Rgb = [0.0024, 0.0042, 0.0098];
export const NIGHT_HORIZON: Rgb = [0.0095, 0.0078, 0.0086];

/**
 * Twilight: after sunset the air still holds light scattered many times —
 * the blue hour, and the Earth's shadow rising opposite the sun, which is
 * dusky blue, never black. Single scattering misses it; this adds it, an
 * even glow fading as the sun sinks (by e every 2.6°), gone by −18°.
 */
export function twilight(sunElevationDeg: number): { zenith: Rgb; horizon: Rgb } {
  if (sunElevationDeg >= 0) {
    // Fades in through the last degrees of the day, so sunset is not a step.
    const k = Math.max(0, 1 - sunElevationDeg / 4);
    return { zenith: scale(TWILIGHT_ZENITH, k), horizon: scale(TWILIGHT_HORIZON, k) };
  }
  if (sunElevationDeg <= -18) return { zenith: [0, 0, 0], horizon: [0, 0, 0] };
  const k = Math.exp(sunElevationDeg / 2.6) * (1 - smooth(-15, -18, sunElevationDeg));
  return { zenith: scale(TWILIGHT_ZENITH, k), horizon: scale(TWILIGHT_HORIZON, k) };
}

const TWILIGHT_ZENITH: Rgb = [0.0038, 0.0085, 0.021];
const TWILIGHT_HORIZON: Rgb = [0.009, 0.011, 0.02];

function scale(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** The sky's glow that is not the sun's or the moon's single scattering: night plus twilight. */
export function ambientSky(sunElevationDeg: number): { zenith: Rgb; horizon: Rgb } {
  const t = twilight(sunElevationDeg);
  const add = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  return { zenith: add(NIGHT_ZENITH, t.zenith), horizon: add(NIGHT_HORIZON, t.horizon) };
}

/**
 * Light the lit town sends back up from its ground at night — lamps on
 * paving, lit shop fronts — as the walls see it from below: a warm glow in
 * the environment's lower half, scaled by how lit the city is (`lamps`).
 */
export const CITY_GLOW: Rgb = [0.024, 0.017, 0.0105];
/** The full moon, as a fraction of the sun: artistic, not the true 1/400 000 — a night photograph's exposure. */
export const MOON_FRACTION = 2e-2;

/**
 * The moon's light above the air for its lit fraction. A half moon gives
 * far less than half a full one's light (the opposition surge): steeper
 * than linear.
 */
export function moonIrradiance(illumination: number): number {
  return SUN_IRRADIANCE * MOON_FRACTION * Math.pow(Math.min(1, Math.max(0, illumination)), 1.6);
}

/** What the island's ground reflects, seen from its walls: mostly pale paving, some sea. */
export const GROUND_ALBEDO: Rgb = [0.34, 0.32, 0.29];

export interface AtmoLight {
  /** Sunlight reaching the island: irradiance on a surface facing the sun. */
  sun: Rgb;
  /** Moonlight reaching it, likewise. */
  moon: Rgb;
  /** Skylight on a horizontal surface: the sun's and the moon's scattering, and the night's own glow. */
  skyUp: Rgb;
  /** The ground's radiance as the environment shows it below the horizon. */
  ground: Rgb;
  /** The sky's glow beyond single scattering (night and twilight), at the zenith and on the horizon. */
  ambient: { zenith: Rgb; horizon: Rgb };
  /** Light on a horizontal surface, all sources (luminance). */
  illuminance: number;
  /** Exposure compensation for it, in stops. */
  exposure: number;
}

const sinDeg = (d: number) => Math.max(0, Math.sin((d * Math.PI) / 180));

/**
 * The light of the moment, from the sun's and the moon's positions, and how
 * lit the town is (`lamps`, 0 by day, 1 at night).
 */
export function atmoLight(
  sunElevation: number,
  sunDir: Vec3,
  moonElevation: number,
  moonDir: Vec3,
  moonIllumination: number,
  lamps = 0
): AtmoLight {
  const sun = sunlight(sunElevation);
  const moonIrr = moonIrradiance(moonIllumination);
  const moonT = sunlight(moonElevation);
  const moon: Rgb = [(moonT[0] * moonIrr) / SUN_IRRADIANCE, (moonT[1] * moonIrr) / SUN_IRRADIANCE, (moonT[2] * moonIrr) / SUN_IRRADIANCE];
  const zero: Rgb = [0, 0, 0];
  const fromSun = sunElevation > -14 ? skyIrradiance(sunDir, SUN_IRRADIANCE, 4, 8) : zero;
  const fromMoon = moonElevation > -2 && moonIrr > 0 ? skyIrradiance(moonDir, moonIrr, 3, 6) : zero;
  const ambient = ambientSky(sunElevation);
  // An even glow from zenith to horizon, integrated with the cosine.
  const floor = (c: 0 | 1 | 2) => Math.PI * (0.55 * ambient.zenith[c] + 0.45 * ambient.horizon[c]);
  const skyUp: Rgb = [fromSun[0] + fromMoon[0] + floor(0), fromSun[1] + fromMoon[1] + floor(1), fromSun[2] + fromMoon[2] + floor(2)];
  const s = sinDeg(sunElevation);
  const m = sinDeg(moonElevation);
  const city = Math.min(1, Math.max(0, lamps));
  const onGround = (c: 0 | 1 | 2) => (GROUND_ALBEDO[c] * (sun[c] * s + moon[c] * m + skyUp[c])) / Math.PI + CITY_GLOW[c] * city;
  const illuminance = luminance(sun) * s + luminance(moon) * m + luminance(skyUp);
  return {
    sun,
    moon,
    skyUp,
    ground: [onGround(0), onGround(1), onGround(2)],
    ambient,
    illuminance,
    exposure: exposureFor(illuminance),
  };
}

/** The longest exposure: night stays night, a little lifted. */
export const MAX_EXPOSURE = 3.3;

/** Noon on a clear day, the reference exposure. */
export const REFERENCE_ILLUMINANCE = 4.2;

/**
 * Exposure compensation, in stops, for this much light. Partial adaptation,
 * like the eye and like a photographer's meter: dusk is still darker than
 * noon, night is still night — but neither is a black frame.
 */
export function exposureFor(illuminance: number): number {
  const ev = Math.log2(REFERENCE_ILLUMINANCE / Math.max(1e-6, illuminance));
  return Math.min(MAX_EXPOSURE, Math.max(-0.4, ev * 0.55));
}

/** A number as a GLSL float literal. */
function glf(n: number): string {
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/**
 * The same integral, in GLSL: `vec3 skyRadiance(vec3 view, vec3 light,
 * float irradiance)`. Fewer steps than the reference (24 × 8) — it runs for
 * every texel of the sky's map — and the same constants, generated from this
 * module so the two cannot drift apart.
 */
export function atmosphereGLSL(): string {
  const v3 = (c: Rgb) => `vec3(${glf(c[0])}, ${glf(c[1])}, ${glf(c[2])})`;
  return /* glsl */ `
    const float EARTH_R = ${glf(EARTH_RADIUS)};
    const float TOP_R = ${glf(ATMOSPHERE_TOP)};
    const float OBSERVER_H = ${glf(OBSERVER_HEIGHT)};
    const vec3 RAYLEIGH = ${v3(RAYLEIGH)};
    const float RAYLEIGH_H = ${glf(RAYLEIGH_HEIGHT)};
    const float MIE_SCAT = ${glf(MIE_SCATTERING)};
    const float MIE_EXT = ${glf(MIE_EXTINCTION)};
    const float MIE_H = ${glf(MIE_HEIGHT)};
    const float MIE_G = ${glf(MIE_G)};
    const vec3 OZONE = ${v3(OZONE)};
    const float OZONE_C = ${glf(OZONE_CENTER)};
    const float OZONE_W = ${glf(OZONE_WIDTH)};
    const float MULTI = ${glf(MULTIPLE_SCATTERING)};
    const float ATMO_PI = 3.141592653589793;

    vec3 atmoExtinction(float h) {
      h = max(h, 0.0);
      float ozone = max(0.0, 1.0 - abs(h - OZONE_C) / OZONE_W);
      return RAYLEIGH * exp(-h / RAYLEIGH_H) + MIE_EXT * exp(-h / MIE_H) + OZONE * ozone;
    }

    // Length to the top of the air, or to the ground (w = 1).
    vec2 atmoRay(float r, float mu) {
      float discGround = r * r * (mu * mu - 1.0) + EARTH_R * EARTH_R;
      if (mu < 0.0 && discGround >= 0.0) return vec2(max(0.0, -r * mu - sqrt(discGround)), 1.0);
      float discTop = r * r * (mu * mu - 1.0) + TOP_R * TOP_R;
      return vec2(max(0.0, -r * mu + sqrt(max(0.0, discTop))), 0.0);
    }

    vec3 atmoTransmittance(float h, float mu) {
      float r = EARTH_R + h;
      vec2 ray = atmoRay(r, mu);
      if (ray.y > 0.5) return vec3(0.0);
      vec3 tau = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float u = (float(i) + 0.5) / 8.0;
        float t = ray.x * u * u;
        float ds = 2.0 * ray.x * u / 8.0;
        float hh = sqrt(r * r + t * t + 2.0 * r * mu * t) - EARTH_R;
        tau += atmoExtinction(hh) * ds;
      }
      return exp(-tau);
    }

    float atmoRayleighPhase(float c) { return 3.0 / (16.0 * ATMO_PI) * (1.0 + c * c); }
    float atmoMiePhase(float c) {
      float g2 = MIE_G * MIE_G;
      return 3.0 / (8.0 * ATMO_PI) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * c, 1.5));
    }

    vec3 skyRadiance(vec3 view, vec3 light, float irradiance) {
      float r0 = EARTH_R + OBSERVER_H;
      vec2 ray = atmoRay(r0, view.y);
      float c = dot(view, light);
      float iso = MULTI / (4.0 * ATMO_PI);
      float pr = atmoRayleighPhase(c) + iso;
      float pm = atmoMiePhase(c) + iso;
      vec3 sum = vec3(0.0);
      vec3 tau = vec3(0.0);
      for (int i = 0; i < 24; i++) {
        float u = (float(i) + 0.5) / 24.0;
        float t = ray.x * u * u;
        float ds = 2.0 * ray.x * u / 24.0;
        vec3 p = vec3(0.0, r0, 0.0) + view * t;
        float pr0 = length(p);
        float h = pr0 - EARTH_R;
        vec3 ext = atmoExtinction(h);
        vec3 sun = atmoTransmittance(h, dot(p, light) / pr0);
        float hc = max(h, 0.0);
        vec3 scatter = RAYLEIGH * exp(-hc / RAYLEIGH_H) * pr + MIE_SCAT * exp(-hc / MIE_H) * pm;
        sum += exp(-(tau + ext * ds * 0.5)) * sun * scatter * ds;
        tau += ext * ds;
      }
      return sum * irradiance;
    }
  `;
}
