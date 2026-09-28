import type { SkyState } from "./sky";

/**
 * The island's colour grading: how the rendered light becomes a picture.
 *
 * The scene is rendered in linear light (scene-referred, HDR). This module
 * decides, for the light of the moment, the exposure, the white balance, the
 * contrast and saturation, and a gentle split toning — the choices a
 * photographer makes at dawn, at noon and at night. The shader
 * (`scene/post.tsx`) then applies them around an AgX tone curve, which keeps
 * bright saturated colours (a sunset, a coloured interior light) from
 * clipping into flat patches.
 *
 * White balance is a real chromatic adaptation (Bradford), from the
 * chromaticity of daylight at a colour temperature (the CIE daylight locus,
 * on which D65 lies exactly — the Planckian locus passes a little below it)
 * to D65. Pure: tested, then uploaded as a matrix.
 */

export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Vec3 = readonly [number, number, number];

/**
 * CIE 1931 xy of daylight at a correlated colour temperature (CIE 15, the
 * D-illuminants' locus; defined from 4000 K to 25000 K, clamped to it).
 */
export function daylightXY(kelvin: number): [number, number] {
  const T = Math.min(25_000, Math.max(4_000, kelvin));
  const t1 = 1e3 / T;
  const t2 = t1 * t1;
  const t3 = t2 * t1;
  const x = T <= 7000 ? -4.607 * t3 + 2.9678 * t2 + 0.09911 * t1 + 0.244063 : -2.0064 * t3 + 1.9018 * t2 + 0.24748 * t1 + 0.23704;
  return [x, -3 * x * x + 2.87 * x - 0.275];
}

/** D65, the white of sRGB. */
export const D65_XY: [number, number] = [0.31271, 0.32902];

const SRGB_TO_XYZ: Mat3 = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const XYZ_TO_SRGB: Mat3 = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV: Mat3 = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];

/** Row-major 3×3 product. */
export function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

export function apply(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function xyToXYZ([x, y]: [number, number]): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

/**
 * A linear-sRGB matrix that adapts colours seen under a light of `kelvin`
 * to D65. A source bluer than D65 (a higher temperature) warms the picture;
 * a redder one (lower) cools it — the photographer's "temperature" slider.
 */
export function whiteBalance(kelvin: number): Mat3 {
  const src = apply(BRADFORD, xyToXYZ(daylightXY(kelvin)));
  const dst = apply(BRADFORD, xyToXYZ(D65_XY));
  const scale: Mat3 = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  return mul(XYZ_TO_SRGB, mul(BRADFORD_INV, mul(scale, mul(BRADFORD, SRGB_TO_XYZ))));
}

export interface Grade {
  /** Stops of exposure. */
  exposure: number;
  /** Kelvin of the light the picture is balanced for (6504 = no correction; lower cools). */
  whiteBalanceK: number;
  /** Around mid-grey, after the tone curve. 1 = unchanged. */
  contrast: number;
  saturation: number;
  /** Extra saturation for the least saturated colours. */
  vibrance: number;
  /** Multipliers for the shadows and the highlights, near 1. */
  shadowTint: Vec3;
  highlightTint: Vec3;
  /** 0–1, how much the corners darken. */
  vignette: number;
  bloomStrength: number;
  /** Linear luminance above which light blooms. */
  bloomThreshold: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The grade for this light. Three looks, blended by how much sun there is
 * and how low it stands: clear daylight (crisp, balanced for the sun),
 * golden hour (the low sun's colour kept, a touch more saturation), and
 * night (balanced cool, so the sky is blue and the lamps not orange soup;
 * the lamps blooming).
 *
 * `exposure` is the metered exposure (`atmoLight`, from how much light
 * falls on the island); the grade adds nothing to it — it only shapes.
 */
export function gradeFor(sky: SkyState, sunElevation: number, exposure = 0): Grade {
  const night = clamp01(sky.lamps);
  // Golden: the sun low — peaks at 5°, gone by −3° (dusk) and by 18°; continuous either side.
  const g0 = clamp01(1 - Math.abs(sunElevation - 5) / (sunElevation < 5 ? 8 : 13)) * (1 - night * 0.6);
  const d0 = clamp01(1 - night - g0);
  // Weights that always sum to one: at dusk the three overlap.
  const total = night + g0 + d0;
  const [day, golden] = [d0 / total, g0 / total];
  const nightW = night / total;

  // A camera's "daylight" balance: the noon sun (about 5600 K) with the
  // sky's fill reads white. Less correction at golden hour, so the low sun
  // stays golden; more at night, towards the lamps' warmth, so the sky is blue.
  const whiteBalanceK = day * 5900 + golden * 6400 + nightW * 4700;
  const contrast = day * 1.05 + golden * 1.08 + nightW * 1.1;
  const saturation = day * 1.03 + golden * 1.1 + nightW * 1.02;
  const vibrance = day * 0.1 + golden * 0.16 + nightW * 0.08;

  const neutral: Vec3 = [1, 1, 1];
  const coolShadow: Vec3 = [0.98, 0.995, 1.04];
  const blueShadow: Vec3 = [0.93, 0.97, 1.1];
  const dayLight: Vec3 = [1.02, 1.0, 0.98];
  const goldLight: Vec3 = [1.06, 1.01, 0.92];
  const shadowTint = lerp3(lerp3(neutral, coolShadow, clamp01(day + golden)), blueShadow, nightW);
  const highlightTint = lerp3(lerp3(dayLight, goldLight, golden), [1.03, 1.0, 0.97], nightW);

  return {
    exposure,
    whiteBalanceK,
    contrast,
    saturation,
    vibrance,
    shadowTint,
    highlightTint,
    vignette: 0.16 + nightW * 0.1,
    bloomStrength: 0.16 + golden * 0.12 + nightW * 0.5,
    bloomThreshold: lerp(1.6, 1.0, nightW),
  };
}
