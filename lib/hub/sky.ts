import type { MoonPosition, SunPosition } from "./solar";

/**
 * The hub's light for a position of the sun: the sky's colours, the sun's and
 * the moon's light, the water, and how far the city has switched on its
 * lamps.
 *
 * Keyed on the sun's elevation, not on the clock — so dusk is dusk whenever
 * it falls, in Oslo in June as in Dakar in December. Between the keys the
 * colours are mixed in linear light (mixing sRGB values directly darkens the
 * middle of every gradient). Dawn and dusk share their elevations and not
 * their colours: the morning is cooler and pinker, the evening warmer.
 *
 * Pure: the scene reads the result, the tests check it.
 */

/** Linear-light RGB, each channel 0–1. */
export type Rgb = readonly [number, number, number];

export type SkyPhase =
  | "night"
  | "dawn"
  | "sunrise"
  | "morning"
  | "noon"
  | "afternoon"
  | "golden"
  | "sunset"
  | "dusk";

export interface SkyState {
  phase: SkyPhase;
  zenith: Rgb;
  horizon: Rgb;
  /** The halo around the sun near the horizon. */
  sunGlow: Rgb;
  sunColor: Rgb;
  /** Directional sunlight; 0 once the sun is below the horizon. */
  sunIntensity: number;
  moonColor: Rgb;
  moonIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  waterDeep: Rgb;
  waterShallow: Rgb;
  /** Street lamps, lit windows, glowing signs: 0 by day, 1 at night. */
  lamps: number;
  /** How visible the stars are. */
  stars: number;
  /** Reflections of the sky on glass and water. */
  envIntensity: number;
}

interface Key {
  e: number;
  zenith: string;
  horizon: string;
  /** Morning variant of the horizon, where it differs. */
  horizonDawn?: string;
  sunGlow: string;
  sunGlowDawn?: string;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  waterDeep: string;
  waterShallow: string;
  lamps: number;
  stars: number;
  envIntensity: number;
}

/** Keyed by the sun's elevation in degrees, ascending. */
const KEYS: readonly Key[] = [
  {
    e: -18, zenith: "#050914", horizon: "#0e1630", sunGlow: "#141a36", sunColor: "#ff8a4c", sunIntensity: 0,
    hemiSky: "#1d2750", hemiGround: "#07080d", hemiIntensity: 0.55,
    waterDeep: "#041019", waterShallow: "#0b2533", lamps: 1, stars: 1, envIntensity: 0.16,
  },
  {
    e: -10, zenith: "#0a1330", horizon: "#232a55", horizonDawn: "#1f2b58", sunGlow: "#3a2c5c", sunColor: "#ff8a4c",
    sunIntensity: 0, hemiSky: "#27315e", hemiGround: "#0a0b12", hemiIntensity: 0.6,
    waterDeep: "#071726", waterShallow: "#12324a", lamps: 1, stars: 0.75, envIntensity: 0.24,
  },
  {
    e: -4, zenith: "#1c2b63", horizon: "#d2715a", horizonDawn: "#c98299", sunGlow: "#f08a4b", sunGlowDawn: "#f3a0a0",
    sunColor: "#ff7a3d", sunIntensity: 0, hemiSky: "#56588a", hemiGround: "#1a1316", hemiIntensity: 0.72,
    waterDeep: "#0f2a45", waterShallow: "#2d5f78", lamps: 1, stars: 0.2, envIntensity: 0.4,
  },
  {
    e: 0, zenith: "#33549a", horizon: "#f39458", horizonDawn: "#f2a58a", sunGlow: "#ff8c3a", sunGlowDawn: "#ffab7a",
    sunColor: "#ff7a3d", sunIntensity: 0.8, hemiSky: "#a8909e", hemiGround: "#3a2a24", hemiIntensity: 0.8,
    waterDeep: "#1a4468", waterShallow: "#4f8ea5", lamps: 0.85, stars: 0, envIntensity: 0.6,
  },
  {
    e: 6, zenith: "#5584c6", horizon: "#f6c089", horizonDawn: "#f3cfb0", sunGlow: "#ffb466", sunColor: "#ffb36b",
    sunIntensity: 1.9, hemiSky: "#a9c3e6", hemiGround: "#6a5a48", hemiIntensity: 0.8,
    waterDeep: "#1e5a86", waterShallow: "#5fb0c4", lamps: 0.15, stars: 0, envIntensity: 0.85,
  },
  {
    e: 15, zenith: "#4a8ad4", horizon: "#cfe2f1", sunGlow: "#fff0d6", sunColor: "#fff0dc", sunIntensity: 2.7,
    hemiSky: "#bcd7f2", hemiGround: "#7c7466", hemiIntensity: 0.85,
    waterDeep: "#1d6391", waterShallow: "#62c2d6", lamps: 0, stars: 0, envIntensity: 1,
  },
  {
    e: 35, zenith: "#3f84d6", horizon: "#d9ebf7", sunGlow: "#fffaf0", sunColor: "#fffaf2", sunIntensity: 3,
    hemiSky: "#c6def5", hemiGround: "#857c6d", hemiIntensity: 0.9,
    waterDeep: "#1b6a9b", waterShallow: "#6ccbdc", lamps: 0, stars: 0, envIntensity: 1,
  },
];

const MOON_COLOR = "#9fb4e6";

/** sRGB hex → linear-light RGB. */
export function linear(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
}

/** Linear-light RGB → sRGB hex, for the page's CSS. */
export function toHex(rgb: Rgb): string {
  const encode = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${encode(rgb[0])}${encode(rgb[1])}${encode(rgb[2])}`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smooth, so a key is never a visible kink in the change of light. */
const ease = (t: number) => t * t * (3 - 2 * t);

export function phaseOf(sun: Pick<SunPosition, "elevation" | "rising" | "hourAngle">): SkyPhase {
  const e = sun.elevation;
  if (e < -6) return "night";
  if (e < -0.833) return sun.rising ? "dawn" : "dusk";
  if (e < 6) return sun.rising ? "sunrise" : "sunset";
  if (Math.abs(sun.hourAngle) < 15) return "noon";
  if (e < 12) return sun.rising ? "morning" : "golden";
  return sun.rising ? "morning" : "afternoon";
}

/** The light of the hub for this sun (and, at night, this moon). */
export function skyState(sun: SunPosition, moon?: MoonPosition): SkyState {
  const e = Math.min(KEYS[KEYS.length - 1].e, Math.max(KEYS[0].e, sun.elevation));
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = ease((e - a.e) / (b.e - a.e));
  const dawn = sun.rising;

  const col = (pick: (k: Key) => string) => mix(linear(pick(a)), linear(pick(b)), t);
  const num = (pick: (k: Key) => number) => lerp(pick(a), pick(b), t);

  const lamps = num((k) => k.lamps);
  // The moon lights the scene only when it is up and the sun is well down,
  // and a thin crescent barely at all.
  const moonUp = moon ? Math.min(1, Math.max(0, moon.elevation / 10)) : 0;
  const moonIntensity = moon ? lamps * moonUp * (0.2 + 0.8 * moon.illumination) * 0.45 : 0;

  return {
    phase: phaseOf(sun),
    zenith: col((k) => k.zenith),
    horizon: col((k) => (dawn ? (k.horizonDawn ?? k.horizon) : k.horizon)),
    sunGlow: col((k) => (dawn ? (k.sunGlowDawn ?? k.sunGlow) : k.sunGlow)),
    sunColor: col((k) => k.sunColor),
    // No direct light once the sun's upper edge (−0.833°) has gone under.
    sunIntensity: num((k) => k.sunIntensity) * ease(Math.min(1, Math.max(0, (sun.elevation + 0.833) / 1.833))),
    moonColor: linear(MOON_COLOR),
    moonIntensity,
    hemiSky: col((k) => k.hemiSky),
    hemiGround: col((k) => k.hemiGround),
    hemiIntensity: num((k) => k.hemiIntensity),
    waterDeep: col((k) => k.waterDeep),
    waterShallow: col((k) => k.waterShallow),
    lamps,
    stars: num((k) => k.stars),
    envIntensity: num((k) => k.envIntensity),
  };
}
