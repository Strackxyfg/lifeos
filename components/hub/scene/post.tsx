"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { gradeFor, whiteBalance } from "@/lib/hub/grade";
import { useHubLight } from "./light";

/**
 * From rendered light to a photograph.
 *
 * The scene renders in linear light, HDR, into a half-float buffer
 * (multisampled on capable devices). Then: ground-truth ambient occlusion
 * (the soft darkening where walls meet the ground, under benches, in
 * corners — what makes a render read as a photo), bloom on what is truly
 * brighter than white (lamps, lit windows, glints on the sea), and a grade:
 * exposure, white balance (a Bradford adaptation, `lib/hub/grade.ts`), the
 * AgX tone curve, contrast, saturation, split toning, vignette, and a fine
 * grain that also dithers away the banding of sky gradients.
 *
 * A path-traced image, when there is one, enters here too (`source`): it is
 * graded exactly like the rasterised one, so the switch between them is a
 * cross-fade, not a change of look.
 */

const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 0 },
    uWB: { value: new THREE.Matrix3() },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uVibrance: { value: 0 },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.2 },
    uGrain: { value: 0.012 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform mat3 uWB;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVibrance;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    // AgX, as three.js implements it (Blender's AgX base), with a gentle look.
    const mat3 SRGB_TO_REC2020 = mat3(
      vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    const mat3 REC2020_TO_SRGB = mat3(
      vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    const mat3 AGX_INSET = mat3(
      vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
      vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
      vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const mat3 AGX_OUTSET = mat3(
      vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
      vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
      vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));

    vec3 agxContrast(vec3 x) {
      vec3 x2 = x * x;
      vec3 x4 = x2 * x2;
      return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
    }

    vec3 agx(vec3 color) {
      color = SRGB_TO_REC2020 * color;
      color = AGX_INSET * color;
      color = max(color, 1e-10);
      color = clamp((log2(color) + 12.47393) / (4.026069 + 12.47393), 0.0, 1.0);
      color = agxContrast(color);
      // A look between Blender's base and "punchy": the neutral base is flat.
      color = pow(max(color, 0.0), vec3(1.2));
      float l = dot(color, LUMA);
      color = l + 1.2 * (color - l);
      color = AGX_OUTSET * color;
      color = pow(max(vec3(0.0), color), vec3(2.2));
      color = REC2020_TO_SRGB * color;
      return clamp(color, 0.0, 1.0);
    }

    vec3 srgbEncode(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }

    float hash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c *= exp2(uExposure);
      c = uWB * c;
      c = srgbEncode(agx(c));

      // Split toning, weighted by luminance: shadows and highlights nudged apart.
      float l = dot(c, LUMA);
      c *= mix(vec3(1.0), uShadowTint, 1.0 - smoothstep(0.0, 0.5, l));
      c *= mix(vec3(1.0), uHighlightTint, smoothstep(0.45, 1.0, l));

      // Contrast about mid-grey, then saturation (vibrance favours the dull colours).
      c = (c - 0.5) * uContrast + 0.5;
      l = dot(c, LUMA);
      float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      c = mix(vec3(l), c, uSaturation + uVibrance * (1.0 - chroma));

      // Vignette, round whatever the screen's shape.
      vec2 q = vUv - 0.5;
      q.x *= uAspect;
      c *= mix(1.0 - uVignette, 1.0, smoothstep(0.95, 0.2, length(q) * 1.05));

      // Grain, which also dithers away 8-bit banding in the sky.
      c += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 311.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

/**
 * The first pass: the rasterised scene, or — when the path tracer has an
 * image — that image, cross-faded in by `mix`.
 */
class SourcePass extends Pass {
  private render3d: RenderPass;
  private quad: FullScreenQuad;
  traced: THREE.Texture | null = null;
  mix = 0;
  skipRaster = false;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.render3d = new RenderPass(scene, camera);
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tMap: { value: null }, uOpacity: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `uniform sampler2D tMap; uniform float uOpacity; varying vec2 vUv;
          void main() { vec4 t = texture2D(tMap, vUv); gl_FragColor = vec4(t.rgb, uOpacity); }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, delta: number, maskActive: boolean) {
    if (!(this.skipRaster && this.traced && this.mix >= 1)) {
      this.render3d.render(renderer, writeBuffer, readBuffer, delta, maskActive);
    }
    if (this.traced && this.mix > 0) {
      const m = this.quad.material as THREE.ShaderMaterial;
      m.uniforms.tMap.value = this.traced;
      m.uniforms.uOpacity.value = Math.min(1, this.mix);
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(readBuffer);
      this.quad.render(renderer);
      renderer.autoClear = auto;
    }
  }

  setSize(w: number, h: number) {
    this.render3d.setSize(w, h);
  }

  dispose() {
    this.render3d.dispose();
    this.quad.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}

export interface PostHandle {
  source: SourcePass;
  /** The next finished frame, as a PNG — read right after it is drawn. */
  snapshot(): Promise<Blob | null>;
}

export function PostPipeline({
  quality,
  handle,
}: {
  /** "high": MSAA ×4 + ambient occlusion; "medium": no AO, MSAA ×2. */
  quality: "high" | "medium";
  handle?: (h: PostHandle | null) => void;
}) {
  const { gl, scene, camera, size } = useThree();
  const dpr = useThree((s) => s.viewport.dpr);
  const light = useHubLight();
  const seen = useRef(-1);

  const pipeline = useMemo(() => {
    const pr = gl.getPixelRatio();
    const w = Math.max(1, Math.floor(size.width * pr));
    const h = Math.max(1, Math.floor(size.height * pr));
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: quality === "high" ? 4 : 2,
    });
    const composer = new EffectComposer(gl, target);
    const source = new SourcePass(scene, camera);
    composer.addPass(source);
    let gtao: GTAOPass | null = null;
    if (quality === "high") {
      gtao = new GTAOPass(scene, camera, w, h);
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 });
      composer.addPass(gtao);
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.55, 1.2);
    composer.addPass(bloom);
    const grade = new ShaderPass(gradeShader);
    composer.addPass(grade);
    return { composer, source, gtao, bloom, grade };
    // Rebuilt only when the quality changes; sizes follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, quality]);

  // A rebuilt pipeline (the quality changed) starts with default uniforms: grade it again.
  useEffect(() => {
    seen.current = -1;
  }, [pipeline]);

  const pendingShot = useRef<((b: Blob | null) => void) | null>(null);

  useEffect(() => {
    handle?.({
      source: pipeline.source,
      snapshot: () =>
        new Promise((resolve) => {
          pendingShot.current = resolve;
        }),
    });
    // For inspecting the pipeline from the console while developing.
    if (process.env.NODE_ENV === "development") (window as unknown as { __hubPost?: unknown }).__hubPost = pipeline;
    return () => {
      handle?.(null);
      pipeline.composer.dispose();
      pipeline.source.dispose();
    };
  }, [pipeline, handle]);

  // CSS size first, then the ratio: the other order briefly allocates buffers
  // at the ratio squared (the composer starts out sized in device pixels).
  useEffect(() => {
    pipeline.composer.setSize(size.width, size.height);
    pipeline.composer.setPixelRatio(dpr);
  }, [pipeline, dpr, size.width, size.height]);

  // Priority 1: R3F stops rendering on its own; this renders the frame.
  useFrame(({ clock }, delta) => {
    const u = (pipeline.grade.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uAspect.value = size.width / Math.max(1, size.height);
    const l = light.current;
    if (l.version !== seen.current) {
      seen.current = l.version;
      const g = gradeFor(l.sky, l.sun.elevation, l.atmo.exposure);
      u.uExposure.value = g.exposure;
      const m = whiteBalance(g.whiteBalanceK);
      (u.uWB.value as THREE.Matrix3).set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
      u.uContrast.value = g.contrast;
      u.uSaturation.value = g.saturation;
      u.uVibrance.value = g.vibrance;
      (u.uShadowTint.value as THREE.Vector3).set(...g.shadowTint);
      (u.uHighlightTint.value as THREE.Vector3).set(...g.highlightTint);
      u.uVignette.value = g.vignette;
      pipeline.bloom.strength = g.bloomStrength;
      // The bloom sees the scene before the exposure: its threshold follows.
      pipeline.bloom.threshold = g.bloomThreshold * Math.pow(2, -g.exposure);
    }
    // A traced image has its occlusion already; screen-space AO on top would double it.
    const { gtao, source } = pipeline;
    if (gtao) {
      gtao.enabled = source.mix < 1;
      gtao.blendIntensity = 0.85 * (1 - Math.min(1, source.mix));
    }
    pipeline.composer.render(delta);
    // The drawing buffer is only readable in the task that drew it.
    const shot = pendingShot.current;
    if (shot) {
      pendingShot.current = null;
      gl.domElement.toBlob((b) => shot(b), "image/png");
    }
  }, 1);

  return null;
}
