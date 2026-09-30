"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { GTAOShader, generateMagicSquareNoise } from "three/examples/jsm/shaders/GTAOShader.js";
import { gradeFor, whiteBalance } from "@/lib/hub/grade";
import { useHubLight } from "./light";
import { sceneFormat } from "./buffer";

/**
 * From rendered light to a photograph — for a fraction of what it used to cost.
 *
 * The scene renders once, in linear HDR, into a multisampled buffer of
 * 11-bit floats (`sceneFormat`), with its depth kept. Then:
 *
 * - Ambient occlusion (GTAO, three's own shader): the soft darkening where
 *   walls meet the ground, under benches, in corners. Computed at half
 *   resolution from that depth — normals rebuilt from it, so the scene is
 *   not drawn a second time — then smoothed by a 4×4 depth-aware filter
 *   (the method's own spatial denoiser) and brought back to full resolution
 *   by an upsample that respects edges, inside the grade pass. Each
 *   occlusion texel carries its own distance beside it, so the filter and
 *   the upsample read one texture where they read two.
 * - Bloom on what is truly brighter than white (lamps, lit windows, glints
 *   on the sea): a chain of half-, quarter-, eighth-… resolution images,
 *   each filtered once on the way down and once on the way up, added in the
 *   grade pass.
 * - The grade: exposure, white balance (a Bradford adaptation,
 *   `lib/hub/grade.ts`), the AgX tone curve, contrast, saturation, split
 *   toning, vignette, and a fine grain that dithers away sky banding.
 *
 * So: one scene draw, a few small passes, and a single full-screen pass to
 * the canvas. The previous chain (three's GTAOPass and UnrealBloomPass) drew
 * the scene twice and ran seven full-resolution passes a frame.
 *
 * A path-traced image, when there is one, enters here too (`source`): it is
 * graded exactly like the rasterised one, so the switch is a cross-fade.
 */

export interface PostQuality {
  /** Multisampling of the scene buffer: 4, 2 or 0. */
  msaa: number;
  /** Ambient occlusion, and its samples per pixel (12 is the reference). */
  aoSamples: number;
}

/** What the WebGL path tracer hands over: its image, and how far it has replaced the raster. */
export interface PostSource {
  traced: THREE.Texture | null;
  mix: number;
  skipRaster: boolean;
}

export interface PostHandle {
  source: PostSource;
  /** The next finished frame, as a PNG — read right after it is drawn. */
  snapshot(): Promise<Blob | null>;
}

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/* ── Ambient occlusion: a 4×4 depth-aware filter at half resolution ── */

// Occlusion texels hold the occlusion in red and their distance (metres)
// in green; the sky, where GTAO writes nothing, keeps the clear: no
// occlusion, and a distance beyond anything on the island (AO_CLEAR).
const aoBlurFragment = /* glsl */ `
  uniform sampler2D tAO;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).rg;
    float z0 = c.g;
    float sum = 0.0;
    float wsum = 0.0;
    // 4×4 covers exactly one period of GTAO's magic-square noise.
    for (int y = -2; y < 2; y++) {
      for (int x = -2; x < 2; x++) {
        vec2 s = texture2D(tAO, vUv + vec2(float(x), float(y)) * uTexel).rg;
        float w = 1.0 - smoothstep(0.0, 0.04 * z0 + 0.02, abs(s.g - z0));
        sum += s.r * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4(wsum > 1e-4 ? sum / wsum : c.r, z0, 0.0, 1.0);
  }
`;

/* ── Bloom: a mip chain, 13 taps down, a tent up ──────────────────── */

const bloomDownFragment = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uTexel;
  uniform float uThreshold;
  uniform float uKnee;
  uniform float uPrefilter;
  varying vec2 vUv;

  vec3 tap(vec2 o) { return texture2D(tSource, vUv + o * uTexel).rgb; }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // Karis average on the first level: a single blazing texel (a sun glint)
  // cannot flicker the whole halo.
  vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
    float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b)), wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
    return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  }
  vec3 threshold(vec3 c) {
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = rq * rq / (4.0 * uKnee + 1e-5);
    return c * max(rq, br - uThreshold) / max(br, 1e-5);
  }
  void main() {
    // Jimenez's 13-tap downsample (Next-Generation Post Processing, 2014).
    vec3 a = tap(vec2(-2.0, -2.0)), b = tap(vec2(0.0, -2.0)), c = tap(vec2(2.0, -2.0));
    vec3 d = tap(vec2(-1.0, -1.0)), e = tap(vec2(1.0, -1.0));
    vec3 f = tap(vec2(-2.0, 0.0)), g = tap(vec2(0.0, 0.0)), h = tap(vec2(2.0, 0.0));
    vec3 i = tap(vec2(-1.0, 1.0)), j = tap(vec2(1.0, 1.0));
    vec3 k = tap(vec2(-2.0, 2.0)), l = tap(vec2(0.0, 2.0)), m = tap(vec2(2.0, 2.0));
    vec3 col;
    if (uPrefilter > 0.5) {
      col = karis(d, e, i, j) * 0.5 + karis(a, b, f, g) * 0.125 + karis(b, c, g, h) * 0.125 + karis(f, g, k, l) * 0.125 + karis(g, h, l, m) * 0.125;
      col = threshold(col);
    } else {
      col = (d + e + i + j) * 0.125 + (a + b + f + g) * 0.03125 + (b + c + g + h) * 0.03125 + (f + g + k + l) * 0.03125 + (g + h + l + m) * 0.03125;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const bloomUpFragment = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uTexel;
  uniform float uWeight;
  varying vec2 vUv;
  vec3 tap(vec2 o) { return texture2D(tSource, vUv + o * uTexel).rgb; }
  void main() {
    // 3×3 tent: the lower level, spread and added onto this one.
    vec3 col = tap(vec2(0.0)) * 4.0
      + (tap(vec2(-1.0, 0.0)) + tap(vec2(1.0, 0.0)) + tap(vec2(0.0, -1.0)) + tap(vec2(0.0, 1.0))) * 2.0
      + tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
    gl_FragColor = vec4(col / 16.0 * uWeight, 1.0);
  }
`;

/** Each level passes on this share of the wider glow below it (UnrealBloom's radius 0.55, in effect). */
const BLOOM_SPREAD = 0.87;

class MipBloom {
  levels: THREE.WebGLRenderTarget[] = [];
  private down = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: bloomDownFragment,
    uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uPrefilter: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  private up = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: bloomUpFragment,
    uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: BLOOM_SPREAD } },
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  private quad = new FullScreenQuad(this.down);

  setSize(width: number, height: number) {
    let w = Math.max(1, Math.floor(width / 2));
    let h = Math.max(1, Math.floor(height / 2));
    const count = Math.max(1, Math.min(6, Math.floor(Math.log2(Math.min(w, h))) - 2));
    for (let i = 0; i < count; i++) {
      const rt = this.levels[i] ?? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      rt.setSize(w, h);
      this.levels[i] = rt;
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
    for (const extra of this.levels.splice(count)) extra.dispose();
  }

  /** Renders the bloom of `source` (linear HDR); the result is `texture`. */
  render(gl: THREE.WebGLRenderer, source: THREE.Texture, width: number, height: number, threshold: number) {
    const d = this.down.uniforms;
    this.quad.material = this.down;
    let src = source;
    let texel = [1 / width, 1 / height];
    this.levels.forEach((rt, i) => {
      d.tSource.value = src;
      (d.uTexel.value as THREE.Vector2).set(texel[0], texel[1]);
      d.uPrefilter.value = i === 0 ? 1 : 0;
      d.uThreshold.value = threshold;
      d.uKnee.value = threshold * 0.5;
      gl.setRenderTarget(rt);
      this.quad.render(gl);
      src = rt.texture;
      texel = [1 / rt.width, 1 / rt.height];
    });
    // Back up the chain, each level adding the wider one below it.
    const u = this.up.uniforms;
    this.quad.material = this.up;
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    for (let i = this.levels.length - 2; i >= 0; i--) {
      const lower = this.levels[i + 1];
      u.tSource.value = lower.texture;
      (u.uTexel.value as THREE.Vector2).set(1 / lower.width, 1 / lower.height);
      gl.setRenderTarget(this.levels[i]);
      this.quad.render(gl);
    }
    gl.autoClear = autoClear;
  }

  get texture(): THREE.Texture {
    return this.levels[0].texture;
  }

  /** The chain's total gain (1 + s + s² + …), so its strength means the same at any size. */
  get gain(): number {
    let g = 0;
    for (let i = 0; i < this.levels.length; i++) g += Math.pow(BLOOM_SPREAD, i);
    return g;
  }

  dispose() {
    for (const rt of this.levels) rt.dispose();
    this.down.dispose();
    this.up.dispose();
    this.quad.dispose();
  }
}

/* ── The grade, with the occlusion and the bloom brought in ───────── */

const gradeFragment = /* glsl */ `
  #include <common>
  #include <packing>
  uniform sampler2D tDiffuse;
  uniform highp sampler2D tDepth;
  uniform sampler2D tAO;
  uniform vec2 uAOTexel;
  uniform float uAO;
  uniform float uNear;
  uniform float uFar;
  uniform sampler2D tBloom;
  uniform float uBloom;
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

  // The half-resolution occlusion, upsampled: of its four nearest texels,
  // those at this pixel's depth count; one across an edge does not bleed.
  float occlusion() {
    float d0 = texture2D(tDepth, vUv).x;
    if (uAO <= 0.0 || d0 >= 1.0) return 1.0;
    float z0 = -perspectiveDepthToViewZ(d0, uNear, uFar);
    vec2 st = vUv / uAOTexel - 0.5;
    vec2 i0 = floor(st);
    vec2 f = st - i0;
    vec2 uv00 = (i0 + 0.5) * uAOTexel;
    vec2 uv10 = uv00 + vec2(uAOTexel.x, 0.0);
    vec2 uv01 = uv00 + vec2(0.0, uAOTexel.y);
    vec2 uv11 = uv00 + uAOTexel;
    vec2 a00 = texture2D(tAO, uv00).rg;
    vec2 a10 = texture2D(tAO, uv10).rg;
    vec2 a01 = texture2D(tAO, uv01).rg;
    vec2 a11 = texture2D(tAO, uv11).rg;
    float tol = 0.03 * z0 + 0.01;
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    w *= vec4(
      1.0 - smoothstep(0.0, tol, abs(a00.g - z0)),
      1.0 - smoothstep(0.0, tol, abs(a10.g - z0)),
      1.0 - smoothstep(0.0, tol, abs(a01.g - z0)),
      1.0 - smoothstep(0.0, tol, abs(a11.g - z0))) + 1e-5;
    float ao = dot(vec4(a00.r, a10.r, a01.r, a11.r), w) / (w.x + w.y + w.z + w.w);
    return mix(1.0, ao, uAO);
  }

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb * occlusion();
    c += texture2D(tBloom, vUv).rgb * uBloom;
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
`;

/** The occlusion's look, unchanged from the GTAOPass settings it replaces. */
const AO = { radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1, distanceFallOff: 1, intensity: 0.85 };

/** What the occlusion targets hold where nothing was drawn: no occlusion, at a distance (m) beyond the island's. */
const AO_CLEAR = new THREE.Color(1, 60000, 0);

function buildPipeline(gl: THREE.WebGLRenderer, quality: PostQuality) {
  const depthTexture = new THREE.DepthTexture(1, 1);
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { ...sceneFormat(gl, quality.msaa), samples: quality.msaa, depthTexture });
  const aoOn = quality.aoSamples > 0;
  const aoTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const aoBlurTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

  const gtao = new THREE.ShaderMaterial({
    defines: {
      ...GTAOShader.defines,
      SAMPLES: Math.max(1, quality.aoSamples),
      NORMAL_VECTOR_TYPE: 0,
      DEPTH_SWIZZLING: "x",
      PERSPECTIVE_CAMERA: 1,
      // The texel's distance beside its occlusion, for the filter and the upsample.
      FRAGMENT_OUTPUT: "vec4(ao, -viewPos.z, 0.0, 1.0)",
    },
    uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
    vertexShader: GTAOShader.vertexShader,
    fragmentShader: GTAOShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const noise = generateMagicSquareNoise();
  gtao.uniforms.tNoise.value = noise;
  gtao.uniforms.tDepth.value = depthTexture;
  gtao.uniforms.radius.value = AO.radius;
  gtao.uniforms.distanceExponent.value = AO.distanceExponent;
  gtao.uniforms.thickness.value = AO.thickness;
  gtao.uniforms.scale.value = AO.scale;
  gtao.uniforms.distanceFallOff.value = AO.distanceFallOff;

  const aoBlur = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: aoBlurFragment,
    uniforms: { tAO: { value: aoTarget.texture }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  });

  const grade = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: gradeFragment,
    uniforms: {
      tDiffuse: { value: sceneTarget.texture },
      tDepth: { value: depthTexture },
      tAO: { value: aoBlurTarget.texture },
      uAOTexel: { value: new THREE.Vector2() },
      uAO: { value: aoOn ? AO.intensity : 0 },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      tBloom: { value: null },
      uBloom: { value: 0 },
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
    depthTest: false,
    depthWrite: false,
  });

  const overlay = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: `uniform sampler2D tMap; uniform float uOpacity; varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(tMap, vUv).rgb, uOpacity); }`,
    uniforms: { tMap: { value: null }, uOpacity: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const bloom = new MipBloom();
  const quad = new FullScreenQuad(grade);
  const source: PostSource = { traced: null, mix: 0, skipRaster: false };
  return { quality, aoOn, sceneTarget, depthTexture, aoTarget, aoBlurTarget, gtao, noise, aoBlur, grade, overlay, bloom, quad, source, width: 1, height: 1 };
}

type Pipeline = ReturnType<typeof buildPipeline>;

function disposePipeline(p: Pipeline) {
  p.sceneTarget.dispose();
  p.depthTexture.dispose();
  p.aoTarget.dispose();
  p.aoBlurTarget.dispose();
  p.gtao.dispose();
  p.noise.dispose();
  p.aoBlur.dispose();
  p.grade.dispose();
  p.overlay.dispose();
  p.bloom.dispose();
  p.quad.dispose();
}

export function PostPipeline({ quality, handle }: { quality: PostQuality; handle?: (h: PostHandle | null) => void }) {
  const { gl, scene, camera, size } = useThree();
  const dpr = useThree((s) => s.viewport.dpr);
  const light = useHubLight();
  const seen = useRef(-1);
  /** The bloom's threshold (scene units) and strength, from the grade of the moment. */
  const bloomOf = useRef({ threshold: 1, strength: 0 });
  const clear = useMemo(() => new THREE.Color(), []);

  const pipeline = useMemo(
    () => buildPipeline(gl, quality),
    // Rebuilt only when the quality itself changes; sizes follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gl, quality.msaa, quality.aoSamples]
  );

  // A rebuilt pipeline starts with default uniforms: grade it again.
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
    // For inspecting the pipeline from the console while developing, and for a bench (`?perf=1`).
    if (process.env.NODE_ENV === "development") (window as unknown as { __hubPost?: unknown }).__hubPost = pipeline;
    const bench = (window as unknown as { __hub?: { post?: unknown } }).__hub;
    if (bench) bench.post = pipeline;
    return () => {
      handle?.(null);
      disposePipeline(pipeline);
    };
  }, [pipeline, handle]);

  useEffect(() => {
    const w = Math.max(1, Math.floor(size.width * dpr));
    const h = Math.max(1, Math.floor(size.height * dpr));
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    pipeline.width = w;
    pipeline.height = h;
    pipeline.sceneTarget.setSize(w, h);
    pipeline.aoTarget.setSize(hw, hh);
    pipeline.aoBlurTarget.setSize(hw, hh);
    pipeline.gtao.uniforms.resolution.value.set(hw, hh);
    (pipeline.aoBlur.uniforms.uTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
    (pipeline.grade.uniforms.uAOTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
    pipeline.bloom.setSize(w, h);
  }, [pipeline, dpr, size.width, size.height]);

  // Priority 1: R3F stops rendering on its own; this renders the frame.
  useFrame(({ clock }) => {
    const p = pipeline;
    const g = p.grade.uniforms;
    const cam = camera as THREE.PerspectiveCamera;
    g.uTime.value = clock.elapsedTime;
    g.uAspect.value = size.width / Math.max(1, size.height);
    const l = light.current;
    if (l.version !== seen.current) {
      seen.current = l.version;
      const gr = gradeFor(l.sky, l.sun.elevation, l.atmo.exposure);
      g.uExposure.value = gr.exposure;
      const m = whiteBalance(gr.whiteBalanceK);
      (g.uWB.value as THREE.Matrix3).set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
      g.uContrast.value = gr.contrast;
      g.uSaturation.value = gr.saturation;
      g.uVibrance.value = gr.vibrance;
      (g.uShadowTint.value as THREE.Vector3).set(...gr.shadowTint);
      (g.uHighlightTint.value as THREE.Vector3).set(...gr.highlightTint);
      g.uVignette.value = gr.vignette;
      // The bloom sees the scene before the exposure: its threshold follows.
      bloomOf.current = { threshold: gr.bloomThreshold * Math.pow(2, -gr.exposure), strength: gr.bloomStrength };
    }

    const autoClear = gl.autoClear;
    gl.getClearColor(clear);
    const clearAlpha = gl.getClearAlpha();

    // 1. The scene (or the traced image, fading in over it).
    const src = p.source;
    gl.setRenderTarget(p.sceneTarget);
    // gl.render clears (autoClear); a frame that skips the raster clears itself.
    if (!(src.skipRaster && src.traced && src.mix >= 1)) gl.render(scene, camera);
    else gl.clear();
    if (src.traced && src.mix > 0) {
      p.overlay.uniforms.tMap.value = src.traced;
      p.overlay.uniforms.uOpacity.value = Math.min(1, src.mix);
      p.quad.material = p.overlay;
      gl.autoClear = false;
      p.quad.render(gl);
      gl.autoClear = autoClear;
    }

    // 2. Occlusion — not over a traced image, which has its own.
    const aoWeight = p.aoOn ? AO.intensity * (1 - Math.min(1, src.mix)) : 0;
    g.uAO.value = aoWeight;
    g.uNear.value = cam.near;
    g.uFar.value = cam.far;
    if (aoWeight > 0) {
      const u = p.gtao.uniforms;
      u.cameraNear.value = cam.near;
      u.cameraFar.value = cam.far;
      u.cameraProjectionMatrix.value.copy(cam.projectionMatrix);
      u.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
      u.cameraWorldMatrix.value.copy(cam.matrixWorld);
      // Target first: a clear colour set while drawing to the canvas would
      // be converted to its sRGB, and the distance in green with it.
      gl.setRenderTarget(p.aoTarget);
      gl.setClearColor(AO_CLEAR, 1);
      p.quad.material = p.gtao;
      p.quad.render(gl);
      gl.setRenderTarget(p.aoBlurTarget);
      p.quad.material = p.aoBlur;
      p.quad.render(gl);
      gl.setClearColor(clear, clearAlpha);
    }

    // 3. Bloom.
    p.bloom.render(gl, p.sceneTarget.texture, p.width, p.height, bloomOf.current.threshold);
    g.tBloom.value = p.bloom.texture;
    // UnrealBloomPass summed its five mips with weights adding to 3.35 (radius
    // 0.55); this chain sums with its own gain — scaled so a strength means the same.
    g.uBloom.value = (bloomOf.current.strength * 3.35) / p.bloom.gain;

    // 4. The grade, to the canvas.
    gl.setRenderTarget(null);
    p.quad.material = p.grade;
    p.quad.render(gl);

    // The drawing buffer is only readable in the task that drew it.
    const shot = pendingShot.current;
    if (shot) {
      pendingShot.current = null;
      gl.domElement.toBlob((b) => shot(b), "image/png");
    }
  }, 1);

  return null;
}
