"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { WebGLPathTracer } from "three-gpu-pathtracer";
import type { PostHandle } from "./post";
import { useSkyMap } from "./atmosphere";
import { useHubLight } from "./light";
import { lightScale } from "./materials";
import { buildTraceScene, type TraceScene } from "./trace";
import { pacer } from "../pacer-store";

/**
 * Photo mode: the view in front of you, path traced.
 *
 * Light is followed as it really travels — bouncing off the paving onto
 * the walls, through the windows into the rooms, reflected by the sea and
 * the glass, softened by the size of the sky — sample after sample, until
 * the image converges.
 *
 * Two engines, the better one first:
 *
 * - WebGPU (Chrome, Edge, recent Firefox and Safari): compute shaders on
 *   the GPU's native API. The picture is drawn on a canvas laid over the
 *   live view, which pauses once the photo covers it.
 * - WebGL, where WebGPU is missing. Not on Windows' Direct3D 11 translation
 *   (Chrome and Edge's default there): it compiles this tracer wrongly —
 *   every surface comes out black — so it is refused, with the reason,
 *   rather than shown broken.
 *
 * The scene is a still (`trace.ts`): the moment you pressed the button.
 * Touching the camera ends it.
 */

export interface PhotoProgress {
  phase: "preparing" | "compiling" | "tracing" | "done" | "failed";
  samples: number;
  target: number;
  /** Why it failed: this browser cannot trace, or something broke. */
  reason?: "unsupported" | "error";
}

export interface PhotoShot {
  /** The finished picture, as a PNG. */
  snapshot(): Promise<Blob | null>;
}

type Engine =
  | {
      kind: "webgpu";
      canvas: HTMLCanvasElement;
      renderer: { dispose(): void; toneMappingExposure: number };
      tracer: { renderSample(): void; updateCamera(): void; dispose(): void; getSampleCountsAsync(): Promise<{ min: number; avg: number }> };
    }
  | { kind: "webgl"; tracer: WebGLPathTracer };

/** Windows' ANGLE Direct3D 11 translation, which miscompiles the WebGL tracer. */
function isD3D11(gl: THREE.WebGLRenderer): boolean {
  const ctx = gl.getContext();
  const ext = ctx.getExtension("WEBGL_debug_renderer_info");
  const name = ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  return /Direct3D11|D3D11/i.test(name);
}

async function webgpuAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

export function PhotoMode({
  active,
  post,
  target,
  onProgress,
  onExit,
  shot,
}: {
  active: boolean;
  post: React.MutableRefObject<PostHandle | null>;
  /** Samples to accumulate before stopping. */
  target: number;
  onProgress: (p: PhotoProgress) => void;
  onExit: () => void;
  /** Filled while a photo is shown, so the page can save it. */
  shot: React.MutableRefObject<PhotoShot | null>;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    addEventListener?: (t: string, f: () => void) => void;
    removeEventListener?: (t: string, f: () => void) => void;
  } | null;
  const skyMap = useSkyMap();
  const light = useHubLight();
  const state = useRef<{ engine: Engine | null; traced: TraceScene | null; done: boolean; reported: number }>({
    engine: null,
    traced: null,
    done: false,
    reported: -1,
  });
  const lastCamera = useRef(new THREE.Matrix4());
  const exit = useRef(onExit);
  exit.current = onExit;
  const progress = useRef(onProgress);
  progress.current = onProgress;

  // Any hand on the camera ends the photo: it is of this view, now.
  useEffect(() => {
    if (!active || !controls?.addEventListener) return;
    const stop = () => exit.current();
    controls.addEventListener("controlstart", stop);
    return () => controls.removeEventListener?.("controlstart", stop);
  }, [active, controls]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let raf = 0;
    const s = state.current;
    s.done = false;
    s.reported = -1;
    progress.current({ phase: "preparing", samples: 0, target });
    const fail = (reason: "unsupported" | "error", err?: unknown) => {
      if (err) console.error("photo mode", err);
      if (!cancelled) progress.current({ phase: "failed", samples: 0, target, reason });
    };

    // Let the "preparing" state paint before the heavy work starts.
    const timer = setTimeout(async () => {
      try {
        const map = skyMap.current.texture;
        if (!map) throw new Error("no sky map yet");
        const l = light.current;
        const exposure = Math.pow(2, l.atmo.exposure);
        camera.updateMatrixWorld();
        lastCamera.current.copy(camera.matrixWorld);

        if (await webgpuAvailable()) {
          const [{ WebGPURenderer, AgXToneMapping, SRGBColorSpace }, { WebGPUPathTracer }] = await Promise.all([
            import("three/webgpu"),
            import("three-gpu-pathtracer/webgpu"),
          ]);
          if (cancelled) return;
          const traced = buildTraceScene(gl, scene, { skyMap: map, lamps: l.sky.lamps, lightScale: lightScale(l.atmo.exposure) });
          const host = gl.domElement.parentElement;
          const canvas = document.createElement("canvas");
          canvas.setAttribute("aria-hidden", "true");
          Object.assign(canvas.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            opacity: "0",
            transition: "opacity 600ms ease",
          });
          host?.appendChild(canvas);
          const size = gl.getSize(new THREE.Vector2());
          const renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false });
          renderer.setPixelRatio(gl.getPixelRatio());
          renderer.setSize(size.x, size.y, false);
          await renderer.init();
          if (cancelled) {
            renderer.dispose();
            canvas.remove();
            traced.dispose();
            return;
          }
          // The live view's curve and exposure; the rest of its grade is
          // the live pipeline's own, and the traced light is the point here.
          renderer.toneMapping = AgXToneMapping;
          renderer.toneMappingExposure = exposure;
          renderer.outputColorSpace = SRGBColorSpace;
          const tracer = new WebGPUPathTracer(renderer);
          tracer.maxBounces = 6;
          tracer.renderDelay = 0;
          tracer.dynamicLowRes = false;
          tracer.minSamples = 1;
          tracer.fadeDuration = 0;
          tracer.maxSamples = target;
          tracer.setScene(traced.scene, camera);
          s.engine = { kind: "webgpu", canvas, renderer, tracer };
          s.traced = traced;

          let frames = 0;
          let pendingShot: ((b: Blob | null) => void) | null = null;
          // The sample budget follows the device: measured over the first
          // seconds, sized for about two and a half minutes of work — an
          // integrated GPU gets a cleaner-than-needed photo in that time, a
          // strong one the full count.
          let goal = target;
          let firstAt = 0;
          let adapted = false;
          shot.current = {
            snapshot: () =>
              new Promise((resolve) => {
                pendingShot = resolve;
              }),
          };
          const loop = () => {
            if (cancelled) return;
            camera.updateMatrixWorld();
            if (!lastCamera.current.equals(camera.matrixWorld)) {
              lastCamera.current.copy(camera.matrixWorld);
              tracer.updateCamera();
              s.done = false;
            }
            tracer.renderSample();
            // The canvas holds the picture only in the task that drew it.
            if (pendingShot) {
              const resolve = pendingShot;
              pendingShot = null;
              canvas.toBlob((b) => resolve(b), "image/png");
            }
            frames++;
            if (frames === 6) {
              canvas.style.opacity = "1";
              // Covered: the live view can rest.
              setTimeout(() => {
                if (!cancelled) pacer.paused = true;
              }, 650);
            }
            if (frames % 20 === 0 && !s.done) {
              tracer
                .getSampleCountsAsync()
                .then((c) => {
                  if (cancelled) return;
                  const n = Math.floor(c.min);
                  const now = performance.now();
                  if (n > 0 && firstAt === 0) firstAt = now;
                  if (!adapted && firstAt > 0 && now - firstAt > 8000) {
                    adapted = true;
                    const perSecond = n / ((now - firstAt) / 1000);
                    goal = Math.max(48, Math.min(target, Math.round((perSecond * 150) / 16) * 16));
                    (tracer as unknown as { maxSamples: number }).maxSamples = goal;
                  }
                  if (n >= goal) s.done = true;
                  if (n !== s.reported) {
                    s.reported = n;
                    progress.current({ phase: s.done ? "done" : "tracing", samples: Math.min(n, goal), target: goal });
                  }
                })
                .catch(() => {});
            }
            raf = requestAnimationFrame(loop);
          };
          progress.current({ phase: "tracing", samples: 0, target });
          raf = requestAnimationFrame(loop);
          return;
        }

        // WebGL — refused where it is known to render black.
        if (isD3D11(gl)) return fail("unsupported");
        const { WebGLPathTracer } = await import("three-gpu-pathtracer");
        if (cancelled) return;
        const traced = buildTraceScene(gl, scene, { skyMap: map, lamps: l.sky.lamps, lightScale: lightScale(l.atmo.exposure) });
        const tracer = new WebGLPathTracer(gl);
        tracer.renderToCanvas = false;
        tracer.rasterizeScene = false;
        tracer.dynamicLowRes = false;
        tracer.minSamples = 1;
        tracer.renderDelay = 0;
        tracer.fadeDuration = 0;
        tracer.bounces = 6;
        tracer.transmissiveBounces = 8;
        tracer.filterGlossyFactor = 0.4;
        // Tiles keep each frame short, so the page stays responsive while it works.
        tracer.tiles.set(2, 2);
        tracer.setScene(traced.scene, camera);
        if (cancelled) {
          tracer.dispose();
          traced.dispose();
          return;
        }
        s.engine = { kind: "webgl", tracer };
        s.traced = traced;
        // The live pipeline's snapshot serves: the traced image goes through it.
        shot.current = { snapshot: () => post.current?.snapshot() ?? Promise.resolve(null) };
      } catch (e) {
        fail("error", e);
      }
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      pacer.paused = false;
      pacer.markActive(1000);
      shot.current = null;
      const src = post.current?.source;
      if (src) {
        src.traced = null;
        src.mix = 0;
        src.skipRaster = false;
      }
      const e = s.engine;
      if (e?.kind === "webgpu") {
        e.tracer.dispose();
        e.renderer.dispose();
        e.canvas.remove();
      } else if (e?.kind === "webgl") {
        e.tracer.dispose();
      }
      s.traced?.dispose();
      s.engine = null;
      s.traced = null;
    };
  }, [active, gl, scene, camera, skyMap, light, post, target, shot]);

  // The WebGL engine: before the post pipeline renders (priority 1), add a
  // sample and hand over the image, which the live grade then develops.
  useFrame(() => {
    const s = state.current;
    const e = s.engine;
    if (!active || e?.kind !== "webgl") return;
    // Samples come a frame at a time: full rate while tracing.
    pacer.markActive(400);
    const tracer = e.tracer;
    const src = post.current?.source;
    camera.updateMatrixWorld();
    if (!lastCamera.current.equals(camera.matrixWorld)) {
      lastCamera.current.copy(camera.matrixWorld);
      tracer.updateCamera();
      s.done = false;
    }
    // Not in the library's types, but part of its API.
    if ((tracer as unknown as { isCompiling: boolean }).isCompiling) {
      if (s.reported !== -2) {
        s.reported = -2;
        progress.current({ phase: "compiling", samples: 0, target });
      }
      return;
    }
    if (!s.done) {
      tracer.renderSample();
      const n = Math.floor(tracer.samples);
      if (n >= target) s.done = true;
      if (n !== s.reported) {
        s.reported = n;
        progress.current({ phase: s.done ? "done" : "tracing", samples: Math.min(n, target), target });
      }
    }
    if (src) {
      src.traced = tracer.target.texture;
      // The first samples are grainy: the live view stays until a few have landed.
      src.mix = Math.min(1, Math.max(0, (tracer.samples - 2) / 6));
      src.skipRaster = src.mix >= 1;
    }
  });

  return null;
}
