"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { DistrictId } from "@/lib/hub/districts";
import type { Place } from "@/lib/hub/place";
import { TIERS, type Tier } from "@/lib/hub/perf";
import { HUB_FOV } from "@/lib/hub/framing";
import { LightProvider, SceneLights, useHubLight } from "./scene/light";
import { SkyProvider } from "./scene/atmosphere";
import { SkyDome } from "./scene/sky";
import { Water } from "./scene/water";
import { Ground } from "./scene/ground";
import { Trees } from "./scene/vegetation";
import { Lamps } from "./scene/lamps";
import { Buildings } from "./scene/buildings";
import { Boats } from "./scene/life";
import { People } from "./scene/people";
import { Birds } from "./scene/birds";
import { Pins, type PinLabel } from "./scene/pins";
import { CameraRig, type CameraGoal } from "./scene/camera-rig";
import { PostPipeline, type PostHandle } from "./scene/post";

// Nothing below depends on the hour: they read the light from its ref each
// frame. Memoised, so scrubbing the time preview re-renders only the light.
const MWater = memo(Water);
const MGround = memo(Ground);
const MTrees = memo(Trees);
const MLamps = memo(Lamps);
const MBuildings = memo(Buildings);
const MPeople = memo(People);
const MBoats = memo(Boats);
const MBirds = memo(Birds);
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
 * How the rendered light becomes the picture. On capable devices, the post
 * pipeline (`scene/post.tsx`): ambient occlusion, bloom, AgX and the grade of
 * the moment. On the lowest tier, three's own AgX curve, straight to screen.
 */
function Look({ tier, onPost }: { tier: Tier; onPost?: (h: PostHandle | null) => void }) {
  const gl = useThree((s) => s.gl);
  const light = useHubLight();
  const seen = useRef(-1);
  useLayoutEffect(() => {
    // The post pipeline tone-maps in its grade pass (the scene renders
    // linear into it); straight to screen, three's AgX does.
    gl.toneMapping = THREE.AgXToneMapping;
    seen.current = -1;
  }, [gl, tier]);
  useFrame(() => {
    const l = light.current;
    if (tier !== "low" || l.version === seen.current) return;
    seen.current = l.version;
    gl.toneMappingExposure = Math.pow(2, l.atmo.exposure);
  });
  if (tier === "low") return null;
  return <PostPipeline quality={tier === "high" ? "high" : "medium"} handle={onPost} />;
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
      shadows="percentage"
      dpr={settings.dpr}
      camera={{ fov: HUB_FOV, near: 0.5, far: 1500, position: [0, 21, 29] }}
      // The post pipeline multisamples its own buffer; the canvas's would be wasted work.
      gl={{ antialias: p.tier === "low" && settings.antialias, powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl }) => {
        gl.shadowMap.type = THREE.PCFShadowMap;
        gl.shadowMap.autoUpdate = false;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          if (alive.current) p.onContextLost();
        });
      }}
      onPointerMissed={() => p.onBackground()}
    >
      <LightProvider time={p.time} place={p.place}>
        <SkyProvider>
          <SceneLights shadows={settings.shadows} shadowSize={settings.shadowSize} />
          <SkyDome reducedMotion={p.reducedMotion} />
          <MWater reducedMotion={p.reducedMotion} />
          <MGround reducedMotion={p.reducedMotion} />
          <MTrees reducedMotion={p.reducedMotion} />
          <MLamps />
          <MBuildings
            hovered={p.hovered}
            focused={focused}
            interactive={interactive}
            onHover={p.onHover}
            onSelect={p.onSelect}
            signs={p.signs}
            reducedMotion={p.reducedMotion}
            lights={settings.interiorLights}
          />
          <MPeople count={settings.people} reducedMotion={p.reducedMotion} />
          <MBoats reducedMotion={p.reducedMotion} />
          <MBirds reducedMotion={p.reducedMotion} />
          <MPins
            labels={p.pinLabels}
            badges={p.badges}
            hovered={p.hovered}
            visible={p.goal.kind === "overview"}
            onHover={p.onHover}
            onSelect={p.onSelect}
          />
          <MCameraRig goal={p.goal} returnFrom={p.returnFrom} reducedMotion={p.reducedMotion} onArrive={p.onArrive} />
          <Look tier={p.tier} />
          <FirstFrames onReady={p.onReady} />
          <PerformanceMonitor onDecline={p.onTierDown} />
        </SkyProvider>
      </LightProvider>
    </Canvas>
  );
}
