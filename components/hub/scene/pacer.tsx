"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { pacer, RATES } from "../pacer-store";

export { pacer, RATES };

export interface FrameInfo {
  /** rAF timestamp of this frame. */
  now: number;
  /** Milliseconds since the previous rendered frame. */
  interval: number;
  /** The interval this frame was aiming at (1000 / its rate). */
  target: number;
  active: boolean;
}

/**
 * Drives R3F by hand — the Canvas has `frameloop="never"` — one `advance`
 * per frame due.
 * The scene's clock runs in seconds, continuous, a step never longer than a
 * tenth of a second (a tab coming back after an hour does not fast-forward).
 */
export function FrameDriver({ onFrame }: { onFrame?: (f: FrameInfo) => void }) {
  const advance = useThree((s) => s.advance);
  const report = useRef(onFrame);
  report.current = onFrame;

  useEffect(() => {
    let raf = 0;
    let next = 0;
    let lastRaf = 0;
    let lastRendered = 0;
    let period = 1000 / 60;
    let clock = 0;
    let lastClock = performance.now();

    type BatteryManager = EventTarget & { charging: boolean };
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    let battery: BatteryManager | null = null;
    const onCharging = () => {
      pacer.onBattery = !!battery && !battery.charging;
    };
    nav.getBattery?.()
      .then((b) => {
        battery = b;
        onCharging();
        b.addEventListener("chargingchange", onCharging);
      })
      .catch(() => {});

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // The display's own period, learnt as it goes (60, 120, 144 Hz…).
      if (lastRaf > 0) {
        const d = t - lastRaf;
        if (d > 2 && d < 100) period += (d - period) * 0.05;
      }
      lastRaf = t;
      if (pacer.paused) {
        lastClock = t;
        return;
      }
      const active = pacer.isActive(t);
      const rate = active
        ? RATES.active
        : !document.hasFocus()
          ? RATES.background
          : pacer.onBattery
            ? RATES.idleOnBattery
            : RATES.idle;
      const interval = Math.max(1000 / rate, period);
      // Half a refresh early is on time: frames land on the screen's beat.
      if (!pacer.uncapped && t < next - period / 2) return;
      // Keep the cadence; after a stall, start again from now.
      next = t - next > interval ? t + interval : next + interval;
      clock += Math.min(0.1, Math.max(0, (t - lastClock) / 1000));
      lastClock = t;
      advance(clock);
      const since = lastRendered > 0 ? t - lastRendered : interval;
      lastRendered = t;
      report.current?.({ now: t, interval: since, target: interval, active });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      battery?.removeEventListener("chargingchange", onCharging);
    };
  }, [advance]);

  return null;
}
