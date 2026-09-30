/**
 * When the island is drawn, and how often — the largest saving of energy.
 *
 * A browser redraws a WebGL scene as fast as the screen refreshes, 60 to 144
 * times a second, whether anything needs it or not. The island needs it
 * only while something moves quickly: the camera flying to a building,
 * a hand turning the view, a pointer hovering. Otherwise what moves is slow
 * — walkers, waves, the drifting camera, the lighthouse — and thirty frames
 * a second show it just as smoothly for half the work. Without focus (the
 * window behind another), fifteen; hidden, the browser stops everything.
 *
 * Anything that starts a quick motion calls `pacer.markActive()`.
 *
 * Kept free of three.js and React Three Fiber on purpose: the page imports
 * it, and the page must not pull the 3D engine into its first download (the
 * scene arrives separately, `hub.tsx`).
 */

export const RATES = {
  /** A hand on the view, a flight, a pointer on a building. */
  active: 60,
  /** Nobody touching anything: the island lives at this rate. */
  idle: 30,
  /** The same, on battery. */
  idleOnBattery: 24,
  /** The window without focus: still alive, barely costing anything. */
  background: 15,
} as const;

export const pacer = {
  /** Set by photo mode while its own picture covers the view. */
  paused: false,
  activeUntil: 0,
  onBattery: false,
  /** Benches only (`?perf=1`): draw on every animation frame, to measure what a frame costs. */
  uncapped: false,
  /** Full rate for the next `ms` milliseconds. */
  markActive(ms = 800) {
    const until = performance.now() + ms;
    if (until > this.activeUntil) this.activeUntil = until;
  },
  isActive(now = performance.now()) {
    return now < this.activeUntil;
  },
};
