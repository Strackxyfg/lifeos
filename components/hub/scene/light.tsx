"use client";

import { createContext, useContext, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { moonPosition, skyDirection, sunPosition, type MoonPosition, type SunPosition } from "@/lib/hub/solar";
import { skyState, type SkyState } from "@/lib/hub/sky";
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
  return {
    sun,
    moon,
    sky: skyState(sun, moon),
    sunDir: new THREE.Vector3(...skyDirection(sun)),
    moonDir: new THREE.Vector3(...skyDirection(moon)),
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
 * The two lights of the island: the sky's (a hemisphere, blue from above,
 * warm from the ground) and one directional — the sun by day, the moon by
 * night, whichever is brighter. Its shadow map is static and re-rendered only
 * when that light has moved (about once a minute): the city does not move,
 * so re-drawing shadows sixty times a second would be pure waste.
 */
export function SceneLights({ shadows, shadowSize }: { shadows: boolean; shadowSize: number }) {
  const light = useHubLight();
  const key = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const { gl, scene } = useThree();
  const seen = useRef(-1);
  const lastDir = useRef(new THREE.Vector3(0, 1, 0));
  const warmup = useRef(4);

  useFrame(() => {
    const l = light.current;
    const k = key.current;
    const h = hemi.current;
    if (!k || !h) return;
    // Every frame: the reflections' cube map is rebuilt from time to time and
    // resets this on the way.
    scene.environmentIntensity = l.sky.envIntensity;
    if (l.version !== seen.current) {
      seen.current = l.version;
      const s = l.sky;
      const bySun = s.sunIntensity >= s.moonIntensity;
      const dir = (bySun ? l.sunDir : l.moonDir).clone();
      // Never light from below the ground: at worst, graze it.
      if (dir.y < 0.06) dir.setY(0.06).normalize();
      k.position.copy(dir).multiplyScalar(48);
      k.color.setRGB(...(bySun ? s.sunColor : s.moonColor));
      k.intensity = bySun ? s.sunIntensity : s.moonIntensity;
      h.color.setRGB(...s.hemiSky);
      h.groundColor.setRGB(...s.hemiGround);
      h.intensity = s.hemiIntensity;
      setLamps(s.lamps);
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
      <hemisphereLight ref={hemi} />
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
