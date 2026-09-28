/**
 * How much of the island a device can draw smoothly.
 *
 * A first guess from what the browser says about the device, before a single
 * frame; the scene then watches its own frame rate and steps down if the
 * guess was too generous. Never up again in the same visit: a scene that
 * flips between qualities is worse than one that is a little plainer.
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

export function lowerTier(t: Tier): Tier {
  return t === "high" ? "medium" : "low";
}

/** What each tier draws. */
export interface TierSettings {
  dpr: [number, number];
  shadows: boolean;
  shadowSize: number;
  antialias: boolean;
  people: number;
}

export const TIERS: Record<Tier, TierSettings> = {
  high: { dpr: [1, 2], shadows: true, shadowSize: 2048, antialias: true, people: 40 },
  medium: { dpr: [1, 1.5], shadows: true, shadowSize: 1024, antialias: true, people: 26 },
  low: { dpr: [1, 1], shadows: false, shadowSize: 512, antialias: false, people: 12 },
};

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
