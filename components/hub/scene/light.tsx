"use client";

import { createContext, useContext, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { moonPosition, skyDirection, sunPosition, type MoonPosition, type SunPosition } from "@/lib/hub/solar";
import { skyState, type SkyState } from "@/lib/hub/sky";
import { atmoLight, luminance, type AtmoLight } from "@/lib/hub/atmosphere";
import type { Place } from "@/lib/hub/place";
import { setLamps } from "./materials";

/**
 * The light of the moment, shared by everything in the scene.
 *
 * Held in a ref, not in React state: the sky changes every minute (and
 * continuously while someone scrubs the time preview), and re-rendering the
 * whole island for that would cost frames. Readers compare `version` in their
 * frame loop and only do work when it moved.
 */
export interface HubLight {
  sky: SkyState;
  /** The physical light of the moment (`lib/hub/atmosphere.ts`). */
  atmo: AtmoLight;
  sun: SunPosition;
  moon: MoonPosition;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** The instant shown — the clock tower reads its hands from it. */
  time: Date;
  version: number;
}

export function computeLight(time: Date, place: Place): Omit<HubLight, "version"> {
  const sun = sunPosition(time, place.lat, place.lon);
  const moon = moonPosition(time, place.lat, place.lon);
  const sunDir = skyDirection(sun);
  const moonDir = skyDirection(moon);
  const sky = skyState(sun, moon);
  return {
    sun,
    moon,
    sky,
    atmo: atmoLight(sun.elevation, sunDir, moon.elevation, moonDir, moon.illumination, sky.lamps),
    sunDir: new THREE.Vector3(...sunDir),
    moonDir: new THREE.Vector3(...moonDir),
    time,
  };
}

const LightContext = createContext<MutableRefObject<HubLight> | null>(null);

export function useHubLight(): MutableRefObject<HubLight> {
  const ref = useContext(LightContext);
  if (!ref) throw new Error("useHubLight outside <LightProvider>");
  return ref;
}

export function LightProvider({ time, place, children }: { time: Date; place: Place; children: ReactNode }) {
  const ref = useRef<HubLight | null>(null);
  // Computed during render so the very first frame already has the right sky.
  useMemo(() => {
    ref.current = { ...computeLight(time, place), version: (ref.current?.version ?? 0) + 1 };
  }, [time, place]);
  return <LightContext.Provider value={ref as MutableRefObject<HubLight>}>{children}</LightContext.Provider>;
}

/**
 * The island's direct light: one directional, the sun by day, the moon by
 * night — whichever gives more — with the colour and strength the
 * atmosphere lets through. The sky's light comes from the environment map
 * (`SkyProvider`), not from a light. The shadow map is static and
 * re-rendered only when that light has moved (about once a minute): the
 * city does not move, so re-drawing shadows sixty times a second would be
 * pure waste.
 */
export function SceneLights({ shadows, shadowSize }: { shadows: boolean; shadowSize: number }) {
  const light = useHubLight();
  const key = useRef<THREE.DirectionalLight>(null);
  const { gl } = useThree();
  const seen = useRef(-1);
  const lastDir = useRef(new THREE.Vector3(0, 1, 0));
  const warmup = useRef(4);

  useFrame(() => {
    const l = light.current;
    const k = key.current;
    if (!k) return;
    if (l.version !== seen.current) {
      seen.current = l.version;
      const a = l.atmo;
      const bySun = luminance(a.sun) >= luminance(a.moon);
      const rgb = bySun ? a.sun : a.moon;
      const dir = (bySun ? l.sunDir : l.moonDir).clone();
      // Never light from below the ground: at worst, graze it.
      if (dir.y < 0.06) dir.setY(0.06).normalize();
      k.position.copy(dir).multiplyScalar(48);
      const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
      k.color.setRGB(rgb[0] / peak, rgb[1] / peak, rgb[2] / peak);
      k.intensity = peak;
      setLamps(l.sky.lamps, a.exposure);
      if (dir.angleTo(lastDir.current) > 0.003) {
        lastDir.current.copy(dir);
        gl.shadowMap.needsUpdate = true;
      }
    }
    // The first frames: things mount and settle, render shadows each time.
    if (warmup.current > 0) {
      warmup.current--;
      gl.shadowMap.needsUpdate = true;
    }
  });

  return (
    <>
      <directionalLight
        ref={key}
        castShadow={shadows}
        shadow-mapSize-width={shadowSize}
        shadow-mapSize-height={shadowSize}
        shadow-camera-left={-19}
        shadow-camera-right={19}
        shadow-camera-top={19}
        shadow-camera-bottom={-19}
        shadow-camera-near={10}
        shadow-camera-far={100}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </>
  );
}
