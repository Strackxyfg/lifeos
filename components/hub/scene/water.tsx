"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { shoreField } from "@/lib/hub/island";
import { useHubLight } from "./light";
import { EQUIRECT_GLSL, useSkyMap } from "./atmosphere";
import { BUFFER_DITHER_GLSL } from "./buffer";

/** The square of sea the shore field covers, centred on the island. */
const EXTENT = 36;
const FIELD = 224;
/** How far out the shallows reach. */
const REACH = 5;

export const WATER_LEVEL = -0.42;

/**
 * Past this distance from the island the sea curves away, like the edge of a
 * small planet: from the hub's high viewpoint that is what lets a band of
 * real sky show above the horizon. Nothing sails out there, so nothing else
 * has to follow the curve.
 */
export const BEND_START = 27;
export const BEND = 0.015;

/** The sea's height at a distance from the island's centre. */
export function seaLevel(distance: number): number {
  const b = Math.max(0, distance - BEND_START);
  return WATER_LEVEL - b * b * BEND;
}

/**
 * How far below the horizontal the curved sea's edge is, seen from `position`
 * looking along `azimuth` (a unit xz direction). Steeper rays meet the sea
 * sooner, so the first ray that meets it is found by bisection.
 */
export function horizonDip(px: number, py: number, pz: number, dx: number, dz: number): number {
  const hits = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    for (let s = 2; s < 900; s += 4) {
      const x = px + dx * s;
      const z = pz + dz * s;
      if (py - t * s <= seaLevel(Math.hypot(x, z))) return true;
    }
    return false;
  };
  let lo = 0;
  let hi = 60;
  if (!hits(hi)) return hi;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (hits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const vertex = /* glsl */ `
  uniform float uBendStart;
  uniform float uBend;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    float b = max(0.0, length(w.xz) - uBendStart);
    w.y -= b * b * uBend;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform sampler2D uSky;
  uniform vec3 uSunLight;
  uniform vec3 uSunDir;
  uniform vec3 uMoonLight;
  uniform vec3 uMoonDir;
  uniform vec3 uSkyUp;
  uniform float uLamps;
  uniform sampler2D uShore;
  uniform float uExtent;
  uniform float uBendStart;
  varying vec3 vWorld;

  const float PI = 3.141592653589793;
  // What the water sends back from below its surface, per unit of light
  // entering it: the open sea's deep blue; over pale sand, turquoise.
  const vec3 DEEP = vec3(0.0055, 0.034, 0.078);
  const vec3 SHALLOW = vec3(0.05, 0.27, 0.3);

  ${EQUIRECT_GLSL}
  ${BUFFER_DITHER_GLSL}

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float waves(vec2 p) {
    float t = uTime * uMotion;
    return noise(p + vec2(t * 0.35, t * 0.2)) * 0.5
      + noise(p * 2.3 - vec2(t * 0.5, -t * 0.3)) * 0.28
      + noise(p * 5.1 + t * 0.7) * 0.14
      + noise(p * 11.3 - t * 0.9) * 0.08;
  }
  vec3 sky(vec3 dir) {
    return texture2D(uSky, skyUv(vec3(dir.x, max(dir.y, 0.002), dir.z))).rgb;
  }
  // Schlick, water's F0 = 0.02.
  float fresnel(float c) { return 0.02 + 0.98 * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
  // Normalised Blinn-Phong: a glint whose energy does not depend on its sharpness.
  float glint(vec3 n, vec3 V, vec3 L, float s) {
    vec3 H = normalize(V + L);
    return (s + 8.0) / (8.0 * PI) * pow(max(dot(n, H), 0.0), s) * fresnel(dot(V, H)) * max(dot(n, L), 0.0);
  }

  void main() {
    vec2 uv = (vWorld.xz + uExtent) / (2.0 * uExtent);
    float inField = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float shore = texture2D(uShore, uv).r * inField;

    // Ripples: a normal from the slope of layered noise, calmer far away
    // (where they would only shimmer between pixels).
    float d = length(vWorld.xz);
    vec3 V = normalize(cameraPosition - vWorld);
    vec2 p = vWorld.xz * 0.45;
    float e = 0.06;
    float h0 = waves(p);
    vec2 grad = vec2(waves(p + vec2(e, 0.0)) - h0, waves(p + vec2(0.0, e)) - h0) / e;
    float calm = 1.0 - 0.6 * smoothstep(20.0, 60.0, length(cameraPosition - vWorld));
    vec3 n = normalize(vec3(-grad.x * 0.085 * calm, 1.0, -grad.y * 0.085 * calm));

    float F = fresnel(dot(n, V));
    vec3 R = reflect(-V, n);
    R.y = abs(R.y);

    // Light entering the water, scattered back up through it.
    vec3 E = uSkyUp + uSunLight * max(uSunDir.y, 0.0) + uMoonLight * max(uMoonDir.y, 0.0);
    vec3 albedo = mix(DEEP, SHALLOW, smoothstep(0.05, 0.95, shore));
    vec3 body = albedo * E / PI;

    vec3 col = mix(body, sky(R), F);
    col += uSunLight * glint(n, V, uSunDir, 1400.0);
    col += uSunLight * glint(n, V, uSunDir, 90.0) * 0.08;
    col += uMoonLight * glint(n, V, uMoonDir, 700.0);

    // The foam line where the sea meets the coast, moving with the water:
    // white foam, lit like any white thing.
    float band = smoothstep(0.84, 0.95, shore) * (1.0 - smoothstep(0.985, 1.0, shore));
    float foam = smoothstep(0.42, 0.72, noise(vWorld.xz * 2.4 + uTime * uMotion * 0.3));
    col = mix(col, 0.75 * E / PI, band * foam * 0.7);

    // At night the city's lights shimmer on the water near the shore.
    float shimmer = 0.5 + 0.5 * sin(vWorld.x * 3.1 + uTime * uMotion * 1.7) * sin(vWorld.z * 2.3 - uTime * uMotion * 1.1);
    col += vec3(1.0, 0.62, 0.3) * uLamps * pow(shore, 3.0) * (0.012 + 0.02 * shimmer);

    // Where it curves away, the sea melts into the horizon — the sky's own
    // radiance there, so the two meet without a seam.
    col = mix(col, sky(vec3(-V.x, 0.0, -V.z)), smoothstep(uBendStart + 6.0, uBendStart + 58.0, d));

    col = bufferDither(col);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The sea: a flat plane shaded as water — the sky reflected by the Fresnel
 * law, the sun's glints, the light scattered back from under the surface
 * (deep blue offshore, turquoise over the sand), the foam — all from the
 * physical sky of the moment and a distance field of the coast.
 */
export function Water({ reducedMotion }: { reducedMotion: boolean }) {
  const light = useHubLight();
  const skyMap = useSkyMap();
  const mesh = useRef<THREE.Mesh>(null);
  const seen = useRef(-1);
  const seenSky = useRef(-1);

  const material = useMemo(() => {
    const field = shoreField(FIELD, EXTENT, REACH);
    const texture = new THREE.DataTexture(field, FIELD, FIELD, THREE.RedFormat, THREE.UnsignedByteType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    // Row 0 of the field is z = −extent; texture v grows with z here, as the shader expects.
    texture.flipY = false;
    texture.needsUpdate = true;
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: 1 },
        uSky: { value: null },
        uSunLight: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonLight: { value: new THREE.Vector3() },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uSkyUp: { value: new THREE.Vector3() },
        uLamps: { value: 0 },
        uShore: { value: texture },
        uExtent: { value: EXTENT },
        uBendStart: { value: BEND_START },
        uBend: { value: BEND },
      },
    });
  }, []);

  useFrame(({ clock }) => {
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uMotion.value = reducedMotion ? 0.15 : 1;
    if (skyMap.current.version !== seenSky.current) {
      seenSky.current = skyMap.current.version;
      u.uSky.value = skyMap.current.texture;
    }
    if (mesh.current) mesh.current.visible = skyMap.current.texture !== null;
    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    const a = l.atmo;
    (u.uSunLight.value as THREE.Vector3).set(...a.sun);
    (u.uSunDir.value as THREE.Vector3).copy(l.sunDir);
    (u.uMoonLight.value as THREE.Vector3).set(...a.moon);
    (u.uMoonDir.value as THREE.Vector3).copy(l.moonDir);
    (u.uSkyUp.value as THREE.Vector3).set(...a.skyUp);
    u.uLamps.value = l.sky.lamps;
  });

  return (
    // After the island (before the sky): the sea's shader, the costliest
    // per pixel, then runs only where the island does not stand.
    <mesh ref={mesh} material={material} rotation-x={-Math.PI / 2} position-y={WATER_LEVEL} receiveShadow={false} renderOrder={5}>
      {/* Fine enough for the curve to be smooth; flat maths near the island. */}
      <planeGeometry args={[900, 900, 150, 150]} />
    </mesh>
  );
}
