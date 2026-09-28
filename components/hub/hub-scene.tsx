"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { DistrictId } from "@/lib/hub/districts";
import type { Place } from "@/lib/hub/place";
import { TIERS, type Tier } from "@/lib/hub/perf";
import { HUB_FOV } from "@/lib/hub/framing";
import { skyDirection, sunPosition } from "@/lib/hub/solar";
import { skyState, toHex } from "@/lib/hub/sky";
import { LightProvider, SceneLights } from "./scene/light";
import { SkyDome } from "./scene/sky";
import { Water } from "./scene/water";
import { Ground } from "./scene/ground";
import { Trees } from "./scene/vegetation";
import { Lamps } from "./scene/lamps";
import { Buildings } from "./scene/buildings";
import { Boats, People } from "./scene/life";
import { Pins, type PinLabel } from "./scene/pins";
import { CameraRig, type CameraGoal } from "./scene/camera-rig";

// Nothing below depends on the hour: they read the light from its ref each
// frame. Memoised, so scrubbing the time preview re-renders only the light.
const MWater = memo(Water);
const MGround = memo(Ground);
const MTrees = memo(Trees);
const MLamps = memo(Lamps);
const MBuildings = memo(Buildings);
const MPeople = memo(People);
const MBoats = memo(Boats);
const MPins = memo(Pins);
const MCameraRig = memo(CameraRig);

export interface HubSceneProps {
  time: Date;
  place: Place;
  goal: CameraGoal;
  returnFrom: DistrictId | null;
  hovered: DistrictId | null;
  onHover: (id: DistrictId | null) => void;
  onSelect: (id: DistrictId) => void;
  onBackground: () => void;
  onArrive: (goal: CameraGoal) => void;
  signs: Record<DistrictId, string>;
  pinLabels: Record<DistrictId, PinLabel>;
  badges: Partial<Record<DistrictId, number>>;
  tier: Tier;
  reducedMotion: boolean;
  onReady: () => void;
  onTierDown: () => void;
  onContextLost: () => void;
}

/**
 * What glass and water reflect: a small room of soft panels coloured like
 * this moment's sky, rendered once into a cube map — nothing downloaded. It
 * is rebuilt when the sky has changed enough to see (every few degrees of
 * sun), not every minute.
 */
function SkyReflections({ time, place }: { time: Date; place: Place }) {
  const sun = sunPosition(time, place.lat, place.lon);
  const s = skyState(sun);
  const bucket = `${Math.round(sun.elevation / 4)}${sun.rising ? "r" : "s"}`;
  const dir = skyDirection(sun);
  const up = Math.max(0.15, dir[1]);
  return (
    <Environment key={bucket} resolution={64} frames={1}>
      <color attach="background" args={[toHex(s.horizon)]} />
      <Lightformer form="rect" color={toHex(s.zenith)} intensity={1.2} scale={[60, 60, 1]} position={[0, 18, 0]} rotation-x={Math.PI / 2} />
      <Lightformer form="rect" color={toHex(s.hemiGround)} intensity={0.35} scale={[60, 60, 1]} position={[0, -12, 0]} rotation-x={-Math.PI / 2} />
      <Lightformer
        form="circle"
        color={toHex(s.sunGlow)}
        intensity={s.sunIntensity > 0 ? 3 : 0.4}
        scale={7}
        position={[dir[0] * 20, up * 20, dir[2] * 20]}
      />
      <Lightformer form="ring" color={toHex(s.horizon)} intensity={0.8} scale={40} position={[0, 0, -22]} />
    </Environment>
  );
}

/** Tells the page the island is drawn — after two frames, so the first is not a blank one. */
function FirstFrames({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    if (++frames.current >= 2) {
      done.current = true;
      onReady();
    }
  });
  return null;
}

export default function HubScene(p: HubSceneProps) {
  const settings = TIERS[p.tier];
  // Unmounting releases the WebGL context on purpose (the renderer forces its
  // loss to free the GPU). That is not a failure to report: only a loss
  // while the scene is still on screen is.
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const interactive = p.goal.kind !== "enter";
  const focused = p.goal.kind === "overview" ? null : p.goal.id;

  return (
    <Canvas
      shadows
      dpr={settings.dpr}
      camera={{ fov: HUB_FOV, near: 0.5, far: 1500, position: [0, 21, 29] }}
      gl={{ antialias: settings.antialias, powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.shadowMap.autoUpdate = false;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          if (alive.current) p.onContextLost();
        });
      }}
      onPointerMissed={() => p.onBackground()}
    >
      <LightProvider time={p.time} place={p.place}>
        <SceneLights shadows={settings.shadows} shadowSize={settings.shadowSize} />
        <SkyReflections time={p.time} place={p.place} />
        <SkyDome reducedMotion={p.reducedMotion} />
        <MWater reducedMotion={p.reducedMotion} />
        <MGround reducedMotion={p.reducedMotion} />
        <MTrees />
        <MLamps />
        <MBuildings
          hovered={p.hovered}
          focused={focused}
          interactive={interactive}
          onHover={p.onHover}
          onSelect={p.onSelect}
          signs={p.signs}
          reducedMotion={p.reducedMotion}
        />
        <MPeople count={settings.people} reducedMotion={p.reducedMotion} />
        <MBoats reducedMotion={p.reducedMotion} />
        <MPins
          labels={p.pinLabels}
          badges={p.badges}
          hovered={p.hovered}
          visible={p.goal.kind === "overview"}
          onHover={p.onHover}
          onSelect={p.onSelect}
        />
        <MCameraRig goal={p.goal} returnFrom={p.returnFrom} reducedMotion={p.reducedMotion} onArrive={p.onArrive} />
        <FirstFrames onReady={p.onReady} />
        <PerformanceMonitor onDecline={p.onTierDown} />
      </LightProvider>
    </Canvas>
  );
}
