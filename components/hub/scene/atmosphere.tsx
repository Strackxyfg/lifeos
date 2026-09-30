"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { atmosphereGLSL, moonIrradiance, SUN_IRRADIANCE } from "@/lib/hub/atmosphere";
import { useHubLight } from "./light";

/**
 * The sky's light, rendered from the physics (`lib/hub/atmosphere.ts`) into
 * an HDR map of every direction — then shared three ways:
 *
 *  · the sky dome shows it (with the sun's disc, the moon, stars, clouds);
 *  · the sea reflects it;
 *  · filtered for every roughness (PMREM), it is the scene's environment:
 *    the ambient light every surface receives from the sky and the ground,
 *    and what glass and polished stone reflect.
 *
 * Below the horizon the map holds the ground as the scene's surfaces see it
 * — the plaza and the sea, lit by this sun and this sky — so walls get the
 * warm light bounced off the paving, as real white towns do.
 *
 * Rebuilt only when the sun or the moon has moved enough to see.
 */

export interface SkyMap {
  /** Equirectangular, linear HDR. Null until the first build. */
  texture: THREE.Texture | null;
  version: number;
}

const SkyMapContext = createContext<MutableRefObject<SkyMap> | null>(null);

export function useSkyMap(): MutableRefObject<SkyMap> {
  const ref = useContext(SkyMapContext);
  if (!ref) throw new Error("useSkyMap outside <SkyProvider>");
  return ref;
}

/** Direction → equirectangular UV, as three's PMREM reads it. */
export const EQUIRECT_GLSL = /* glsl */ `
  vec2 skyUv(vec3 d) {
    return vec2(atan(d.z, d.x) * 0.15915494309 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830988618 + 0.5);
  }
`;

const lutVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const lutFragment = /* glsl */ `
  ${atmosphereGLSL()}
  uniform vec3 uSunDir;
  uniform float uSunIrr;
  uniform vec3 uMoonDir;
  uniform float uMoonIrr;
  uniform vec3 uNightZenith;
  uniform vec3 uNightHorizon;
  uniform vec3 uGround;
  varying vec2 vUv;

  void main() {
    float phi = (vUv.x - 0.5) * 6.283185307;
    float theta = (vUv.y - 0.5) * 3.141592654;
    vec3 d = vec3(cos(theta) * cos(phi), sin(theta), cos(theta) * sin(phi));
    // Below the horizon, the sky is read at the horizon: haze and ground then blend.
    vec3 v = d.y >= 0.0 ? d : normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
    vec3 col = vec3(0.0);
    if (uSunIrr > 0.0) col += skyRadiance(v, uSunDir, uSunIrr);
    if (uMoonIrr > 0.0) col += skyRadiance(v, uMoonDir, uMoonIrr);
    col += mix(uNightHorizon, uNightZenith, sqrt(clamp(v.y, 0.0, 1.0)));
    col = mix(col, uGround, smoothstep(0.0, -0.08, d.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Width of the sky map; half as tall. 0.35° a texel: the sun's glare stays round. */
const LUT_WIDTH = 1024;

export function SkyProvider({ children }: { children: ReactNode }) {
  const light = useHubLight();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const map = useRef<SkyMap>({ texture: null, version: 0 });

  const res = useMemo(() => {
    const lut = new THREE.WebGLRenderTarget(LUT_WIDTH, LUT_WIDTH / 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    lut.texture.mapping = THREE.EquirectangularReflectionMapping;
    lut.texture.wrapS = THREE.RepeatWrapping;
    const material = new THREE.ShaderMaterial({
      vertexShader: lutVertex,
      fragmentShader: lutFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunIrr: { value: SUN_IRRADIANCE },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uMoonIrr: { value: 0 },
        uNightZenith: { value: new THREE.Vector3() },
        uNightHorizon: { value: new THREE.Vector3() },
        uGround: { value: new THREE.Vector3() },
      },
    });
    const quad = new FullScreenQuad(material);
    const pmrem = new THREE.PMREMGenerator(gl);
    return { lut, material, quad, pmrem, env: null as THREE.WebGLRenderTarget | null };
  }, [gl]);

  useEffect(
    () => () => {
      if (scene.environment === res.env?.texture) scene.environment = null;
      res.lut.dispose();
      res.material.dispose();
      res.quad.dispose();
      res.pmrem.dispose();
      res.env?.dispose();
    },
    [res, scene]
  );

  const seen = useRef(-1);
  const lastKey = useRef("");
  const build = useCallback(() => {
    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    // Rebuild when the change is visible: a tenth of a degree of sun, a little moon.
    const key = [
      l.sun.elevation.toFixed(1),
      l.sun.azimuth.toFixed(1),
      l.moon.elevation.toFixed(0),
      l.moon.azimuth.toFixed(0),
      l.moon.illumination.toFixed(2),
    ].join("|");
    if (key === lastKey.current && map.current.texture) return;
    lastKey.current = key;

    const u = res.material.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(l.sunDir);
    // The sun's own scattering is nil long after it has set: skip the integral then.
    u.uSunIrr.value = l.sun.elevation > -14 ? SUN_IRRADIANCE : 0;
    (u.uMoonDir.value as THREE.Vector3).copy(l.moonDir);
    u.uMoonIrr.value = l.moon.elevation > -2 ? moonIrradiance(l.moon.illumination) : 0;
    (u.uGround.value as THREE.Vector3).set(...l.atmo.ground);
    (u.uNightZenith.value as THREE.Vector3).set(...l.atmo.ambient.zenith);
    (u.uNightHorizon.value as THREE.Vector3).set(...l.atmo.ambient.horizon);

    const previous = gl.getRenderTarget();
    gl.setRenderTarget(res.lut);
    res.quad.render(gl);
    gl.setRenderTarget(previous);

    res.env = res.env ? res.pmrem.fromEquirectangular(res.lut.texture, res.env) : res.pmrem.fromEquirectangular(res.lut.texture);
    scene.environment = res.env.texture;
    scene.environmentIntensity = 1;
    map.current.texture = res.lut.texture;
    map.current.version++;
  }, [gl, light, res, scene]);

  // Built before the first frame: materials compile with the environment
  // they will render with (the scene waits for its shaders, `hub-scene.tsx`).
  useLayoutEffect(() => build(), [build]);
  // Priority −1: before anything reads the map this frame.
  useFrame(build, -1);

  return <SkyMapContext.Provider value={map}>{children}</SkyMapContext.Provider>;
}
