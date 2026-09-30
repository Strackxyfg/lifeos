/**
 * How much of the island a device can draw smoothly — and how the drawing
 * adapts without ever looking cheap.
 *
 * A first guess from what the browser says about the device (a tier),
 * before a single frame. Then the scene watches its own frames and, if the
 * device cannot keep up, steps down a ladder of small, nearly invisible
 * savings — a little resolution on a sharp screen, fewer antialiasing
 * samples, fewer occlusion samples — never all at once, never back up in
 * the same visit (a scene that flips between qualities is worse than one
 * that is a hair softer). What the old steps did — switching off the post
 * pipeline, the shadows and the lamps, and drawing without antialiasing — is
 * gone from the ladder: that was a different, worse-looking island.
 */

export type Tier = "high" | "medium" | "low";

export interface DeviceHints {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory (GB), Chromium only. */
  memory?: number;
  /** A touch-first phone or tablet. */
  coarse?: boolean;
  /** Data saver on. */
  saveData?: boolean;
  /** Screen width in CSS pixels. */
  width?: number;
}

export function initialTier(h: DeviceHints): Tier {
  if (h.saveData) return "low";
  if ((h.memory !== undefined && h.memory <= 2) || (h.cores !== undefined && h.cores <= 2)) return "low";
  if (h.coarse || (h.width !== undefined && h.width < 768)) return "medium";
  if ((h.memory !== undefined && h.memory <= 4) || (h.cores !== undefined && h.cores <= 4)) return "medium";
  return "high";
}

/** What a tier draws. */
export interface TierSettings {
  /** The highest pixel ratio drawn (a phone's 3× is not worth its cost here). */
  maxDpr: number;
  shadows: boolean;
  shadowSize: number;
  people: number;
  /**
   * Where the tier starts on the ladder. Null: no post pipeline — straight
   * to a canvas antialiased by the browser — for the weakest devices only.
   */
  startLevel: number | null;
}

export const TIERS: Record<Tier, TierSettings> = {
  // A 4096 shadow map: about a screen pixel per shadow texel on a building
  // seen close (2048 gave stair-stepped edges). Drawn only when the sun has
  // moved — its cost is memory, not frames.
  high: { maxDpr: 2, shadows: true, shadowSize: 4096, people: 40, startLevel: 0 },
  medium: { maxDpr: 1.5, shadows: true, shadowSize: 2048, people: 26, startLevel: 2 },
  low: { maxDpr: 1, shadows: false, shadowSize: 512, people: 12, startLevel: null },
};

/** One rung: how much of the screen's sharpness, antialiasing samples, occlusion samples. */
export interface RenderLevel {
  /** Of the pixel ratio the tier allows; never below one pixel per CSS pixel. */
  dprScale: number;
  msaa: number;
  aoSamples: number;
}

export const LADDER: readonly RenderLevel[] = [
  { dprScale: 1, msaa: 4, aoSamples: 12 },
  { dprScale: 0.85, msaa: 4, aoSamples: 12 },
  { dprScale: 0.85, msaa: 2, aoSamples: 12 },
  { dprScale: 0.7, msaa: 2, aoSamples: 8 },
  { dprScale: 0.7, msaa: 2, aoSamples: 0 },
];

/**
 * The pixel ratio drawn: the device's, capped by the tier, scaled by the
 * rung — and never below one pixel per CSS pixel (below that the island
 * turns soft, which is what "pixelated" meant). A browser zoomed out below
 * 100 % keeps its own ratio.
 */
export function effectiveDpr(level: RenderLevel, deviceDpr: number, maxDpr: number): number {
  const device = deviceDpr > 0 ? deviceDpr : 1;
  const floor = Math.min(1, device);
  return Math.max(floor, Math.min(device, maxDpr) * level.dprScale);
}

/** The next rung below `from` that changes what is drawn on this screen, or null at the bottom. */
export function nextLevel(from: number, deviceDpr: number, maxDpr: number): number | null {
  const here = LADDER[from];
  const dpr = effectiveDpr(here, deviceDpr, maxDpr);
  for (let i = from + 1; i < LADDER.length; i++) {
    const l = LADDER[i];
    if (l.msaa !== here.msaa || l.aoSamples !== here.aoSamples || Math.abs(effectiveDpr(l, deviceDpr, maxDpr) - dpr) > 0.01) return i;
  }
  return null;
}

export interface FrameSample {
  /** Milliseconds since the previous drawn frame. */
  interval: number;
  /** What it was aiming at (1000 / its rate). */
  target: number;
}

/**
 * Watches drawn frames and says when to step down: when, over the last
 * `window` frames, the median frame came late by more than `slow` (1.45).
 * A frame is judged against its aim, but never an aim above `floorFps`: an
 * island that flies at 30 frames a second on a modest GPU is better than
 * one that flies at 60 without its occlusion — quality is given up only
 * below about 20. Silent during `warmup` (shaders compiling, textures
 * uploading) and for `hold` after every step (the new rung compiles too).
 */
export class Governor {
  private samples: number[] = [];
  private holdUntil: number;

  constructor(
    now: number,
    private readonly opts = { warmup: 5000, hold: 4000, window: 45, slow: 1.45, floorFps: 30 }
  ) {
    this.holdUntil = now + opts.warmup;
  }

  /** True when the device cannot keep up: step down, then `stepped()`. */
  sample(now: number, f: FrameSample): boolean {
    if (now < this.holdUntil) return false;
    // A stall (a hidden tab coming back, a long task) says nothing about drawing.
    if (f.interval > 1000 || f.target <= 0) return false;
    this.samples.push(f.interval / Math.max(f.target, 1000 / this.opts.floorFps));
    if (this.samples.length > this.opts.window) this.samples.shift();
    if (this.samples.length < this.opts.window) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] > this.opts.slow;
  }

  stepped(now: number) {
    this.samples = [];
    this.holdUntil = now + this.opts.hold;
  }
}

/** The hints of this browser. */
export function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    coarse: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    saveData: nav.connection?.saveData === true,
    width: typeof window === "undefined" ? undefined : window.innerWidth,
  };
}

/** Whether WebGL 2 can start at all (three.js needs it). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}
