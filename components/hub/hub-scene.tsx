"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DistrictId } from "@/lib/hub/districts";
import type { Place } from "@/lib/hub/place";
import { effectiveDpr, Governor, LADDER, nextLevel, TIERS, type RenderLevel, type Tier } from "@/lib/hub/perf";
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
import { PhotoMode, type PhotoProgress, type PhotoShot } from "./scene/photo";
import { FrameDriver, pacer, type FrameInfo } from "./scene/pacer";
import { batchStatic, programSort } from "./scene/batch";
import { LIFT } from "./scene/lift";

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
  /** `?quality=…`: the rendering is pinned, the scene does not adapt. */
  pinned: boolean;
  reducedMotion: boolean;
  onReady: () => void;
  onContextLost: () => void;
  /** Photo mode: the view, path traced. */
  photo: boolean;
  onPhotoProgress: (p: PhotoProgress) => void;
  onPhotoExit: () => void;
  /** Filled with what the page may ask of the scene (saving the picture). */
  api: MutableRefObject<HubSceneApi | null>;
}

export interface HubSceneApi {
  snapshot(): Promise<Blob | null>;
}

/**
 * How the rendered light becomes the picture. On every tier but the
 * weakest, the post pipeline (`scene/post.tsx`) at the rung the device holds:
 * occlusion, bloom, AgX and the grade of the moment. On the weakest, three's
 * own AgX curve, straight to an antialiased canvas.
 */
function Look({ level, onPost }: { level: RenderLevel | null; onPost?: (h: PostHandle | null) => void }) {
  const gl = useThree((s) => s.gl);
  const light = useHubLight();
  const seen = useRef(-1);
  const direct = level === null;
  useLayoutEffect(() => {
    // The post pipeline tone-maps in its grade pass (the scene renders
    // linear into it); straight to screen, three's AgX does.
    gl.toneMapping = THREE.AgXToneMapping;
    seen.current = -1;
  }, [gl, direct]);
  useFrame(() => {
    const l = light.current;
    if (!direct || l.version === seen.current) return;
    seen.current = l.version;
    gl.toneMappingExposure = Math.pow(2, l.atmo.exposure);
  });
  if (direct) return null;
  return <PostPipeline quality={{ msaa: level.msaa, aoSamples: level.aoSamples }} handle={onPost} />;
}

/**
 * Before the first frame: every shader the island needs, compiled in
 * parallel by the GPU driver (KHR_parallel_shader_compile) instead of one
 * after the other on the page's thread — which froze the page for seconds
 * on a first visit. Then two frames, and the island is shown.
 *
 * Compiled for the target the frames draw into (`offscreen`: the post
 * pipeline's buffer): three leaves tone mapping out of a program that
 * renders into a buffer — the grade does it — and puts it into one that
 * renders to the canvas. Compiled against the canvas, every program was
 * built a second time on the first frame, one after the other on the
 * page's thread: 37 programs, a second of frozen page on each visit.
 */
function Warmup({ offscreen, onCompiled }: { offscreen: boolean; onCompiled: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const done = useRef(onCompiled);
  done.current = onCompiled;
  useEffect(() => {
    let alive = true;
    const finish = () => {
      if (alive) done.current();
    };
    // Passive effect: the sky's environment (set in a layout effect) is in
    // place, so the programs compiled are the ones the frames will use.
    // Only the target's kind matters (a buffer or the canvas), not its size.
    const probe = offscreen ? new THREE.WebGLRenderTarget(1, 1) : null;
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(probe);
    const compiled = gl.compileAsync(scene, camera);
    gl.setRenderTarget(previous);
    probe?.dispose();
    compiled.then(finish, finish);
    return () => {
      alive = false;
    };
  }, [gl, scene, camera, offscreen]);
  return null;
}

/**
 * The ground and every building drawn in as few calls as they have
 * materials, the whole island together (`batch.ts`); hovered buildings
 * still rise (`lift.ts`). Runs once everything inside has mounted.
 */
function StaticBatch({ children }: { children: React.ReactNode }) {
  const root = useRef<THREE.Group>(null);
  useLayoutEffect(() => (root.current ? batchStatic(root.current, { lift: true }) : undefined), []);
  return (
    <group ref={root} name="static">
      {children}
    </group>
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

/** The screen's pixel ratio, followed when the window moves to another screen or the page is zoomed. */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    const query = matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [dpr]);
  return dpr;
}

export default function HubScene(p: HubSceneProps) {
  const settings = TIERS[p.tier];
  const deviceDpr = useDevicePixelRatio();
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

  // The rung of the quality ladder the device holds (null: the direct path).
  const [level, setLevel] = useState<number | null>(settings.startLevel);
  const levelRef = useRef(level);
  levelRef.current = level;
  const governor = useRef<Governor | null>(null);
  const [compiled, setCompiled] = useState(false);
  const onCompiled = useCallback(() => setCompiled(true), []);

  const onFrame = useCallback(
    (f: FrameInfo) => {
      const at = levelRef.current;
      if (p.pinned || at === null) return;
      const g = (governor.current ??= new Governor(f.now));
      if (!g.sample(f.now, f)) return;
      g.stepped(f.now);
      const next = nextLevel(at, window.devicePixelRatio || 1, settings.maxDpr);
      if (next === null) return;
      levelRef.current = next;
      setLevel(next);
    },
    [p.pinned, settings.maxDpr]
  );

  const rung = level === null ? null : LADDER[level];
  const dpr = rung ? effectiveDpr(rung, deviceDpr, settings.maxDpr) : Math.min(deviceDpr, settings.maxDpr);

  useLayoutEffect(() => {
    const bench = (window as unknown as { __hub?: { tier?: Tier; level?: number | null } }).__hub;
    if (bench) {
      bench.tier = p.tier;
      bench.level = level;
    }
  }, [p.tier, level]);

  const interactive = p.goal.kind !== "enter" && !p.photo;
  const focused = p.goal.kind === "overview" ? null : p.goal.id;
  const post = useRef<PostHandle | null>(null);
  const shot = useRef<PhotoShot | null>(null);
  const { api } = p;
  const onPost = useCallback(
    (h: PostHandle | null) => {
      post.current = h;
      // The photo's own picture when one is shown, else the live frame.
      api.current = h ? { snapshot: () => (shot.current ? shot.current.snapshot() : h.snapshot()) } : null;
    },
    [api]
  );

  return (
    <Canvas
      // Frames are drawn when due (`scene/pacer.tsx`), not at the screen's refresh rate.
      frameloop="never"
      shadows="percentage"
      dpr={dpr}
      camera={{ fov: HUB_FOV, near: 0.5, far: 1500, position: [0, 21, 29] }}
      // The post pipeline multisamples its own buffer; the canvas's would be
      // wasted work. Only the direct path asks the browser for antialiasing.
      gl={{ antialias: settings.startLevel === null, powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl, scene }) => {
        performance.mark("hub:canvas");
        // `?perf=1`: the renderer for a bench to read (draw calls, programs, memory).
        if (new URLSearchParams(window.location.search).has("perf")) {
          (window as unknown as { __hub?: unknown }).__hub = { gl, scene, pacer, lift: LIFT };
        }
        gl.shadowMap.type = THREE.PCFShadowMap;
        gl.shadowMap.autoUpdate = false;
        // Opaque objects drawn program by program: fewer uniforms re-sent (`batch.ts`).
        gl.setOpaqueSort(programSort(gl));
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
          {/* Named groups: what a bench (`?perf=1`) can switch off one at a time to price it. */}
          <group name="sky">
            <SkyDome reducedMotion={p.reducedMotion} />
          </group>
          <group name="water">
            <MWater reducedMotion={p.reducedMotion} />
          </group>
          <group name="trees">
            <MTrees reducedMotion={p.reducedMotion} />
          </group>
          <group name="lamps">
            <MLamps />
          </group>
          <StaticBatch>
            <group name="ground">
              <MGround reducedMotion={p.reducedMotion} />
            </group>
            <group name="buildings">
              <MBuildings
                hovered={p.hovered}
                focused={focused}
                interactive={interactive}
                onHover={p.onHover}
                onSelect={p.onSelect}
                signs={p.signs}
                reducedMotion={p.reducedMotion}
              />
            </group>
          </StaticBatch>
          <group name="people">
            <MPeople count={settings.people} reducedMotion={p.reducedMotion} />
          </group>
          <group name="life">
            <MBoats reducedMotion={p.reducedMotion} />
            <MBirds reducedMotion={p.reducedMotion} />
          </group>
          <MPins
            labels={p.pinLabels}
            badges={p.badges}
            hovered={p.hovered}
            visible={p.goal.kind === "overview" && !p.photo}
            onHover={p.onHover}
            onSelect={p.onSelect}
          />
          <MCameraRig goal={p.goal} returnFrom={p.returnFrom} reducedMotion={p.reducedMotion} onArrive={p.onArrive} still={p.photo} />
          <Look level={rung} onPost={onPost} />
          {rung && (
            <PhotoMode
              active={p.photo}
              post={post}
              target={p.tier === "high" ? 512 : 256}
              onProgress={p.onPhotoProgress}
              onExit={p.onPhotoExit}
              shot={shot}
            />
          )}
          <Warmup offscreen={rung !== null} onCompiled={onCompiled} />
          {compiled && (
            <>
              <FrameDriver onFrame={onFrame} />
              <FirstFrames onReady={p.onReady} />
            </>
          )}
        </SkyProvider>
      </LightProvider>
    </Canvas>
  );
}
