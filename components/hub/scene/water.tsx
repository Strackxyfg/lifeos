"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { shoreField } from "@/lib/hub/island";
import { useHubLight } from "./light";

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
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunI;
  uniform vec3 uMoonColor;
  uniform vec3 uMoonDir;
  uniform float uMoonI;
  uniform float uLamps;
  uniform sampler2D uShore;
  uniform float uExtent;
  uniform float uBendStart;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float waves(vec2 p) {
    float t = uTime * uMotion;
    return noise(p + vec2(t * 0.35, t * 0.2)) * 0.6 + noise(p * 2.3 - vec2(t * 0.5, -t * 0.3)) * 0.3 + noise(p * 5.1 + t * 0.7) * 0.1;
  }

  void main() {
    vec2 uv = (vWorld.xz + uExtent) / (2.0 * uExtent);
    float inField = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float shore = texture2D(uShore, uv).r * inField;

    // Colour by depth: the shallows turquoise, the open sea deep blue.
    vec3 base = mix(uDeep, uShallow, smoothstep(0.0, 0.9, shore));

    // Ripples: a normal from the slope of layered noise.
    vec2 p = vWorld.xz * 0.45;
    float e = 0.08;
    float h0 = waves(p);
    vec2 grad = vec2(waves(p + vec2(e, 0.0)) - h0, waves(p + vec2(0.0, e)) - h0) / e;
    vec3 n = normalize(vec3(-grad.x * 0.1, 1.0, -grad.y * 0.1));

    vec3 V = normalize(cameraPosition - vWorld);
    float fresnel = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uHorizon, uZenith, clamp(R.y * 1.6, 0.0, 1.0));
    vec3 col = mix(base, sky, 0.1 + 0.65 * fresnel);

    // Glints of the sun and the moon.
    col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 420.0) * uSunI * 1.4;
    col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 40.0) * uSunI * 0.05;
    col += uMoonColor * pow(max(dot(R, uMoonDir), 0.0), 260.0) * uMoonI * 2.2;

    // The foam line where the sea meets the coast, moving with the water.
    float band = smoothstep(0.84, 0.95, shore) * (1.0 - smoothstep(0.985, 1.0, shore));
    float foam = smoothstep(0.42, 0.72, noise(vWorld.xz * 2.4 + uTime * uMotion * 0.3));
    // Foam is white only in daylight: at night it is barely lighter than the sea.
    float lit = clamp(uSunI / 2.5 + uMoonI * 0.8, 0.0, 1.0);
    vec3 foamColor = mix(base * 1.6 + vec3(0.015), vec3(0.95), lit);
    col = mix(col, foamColor, band * foam * (0.35 + 0.45 * lit));

    // At night the city's lights shimmer on the water near the shore.
    float shimmer = 0.5 + 0.5 * sin(vWorld.x * 3.1 + uTime * uMotion * 1.7) * sin(vWorld.z * 2.3 - uTime * uMotion * 1.1);
    col += vec3(1.0, 0.72, 0.42) * uLamps * pow(shore, 3.0) * (0.06 + 0.1 * shimmer);

    // Where it curves away, the sea melts into the horizon's colour — the
    // sky's own at that height, so the two meet without a seam.
    float d = length(vWorld.xz);
    col = mix(col, uHorizon, smoothstep(uBendStart + 6.0, uBendStart + 58.0, d));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The sea: a flat plane whose colour, ripples, glints and foam are all
 * computed in its shader from the sky of the moment and a distance field of
 * the coast — shallow turquoise near the island, deep blue beyond.
 */
export function Water({ reducedMotion }: { reducedMotion: boolean }) {
  const light = useHubLight();
  const seen = useRef(-1);

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
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: 1 },
        uDeep: { value: new THREE.Color() },
        uShallow: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunI: { value: 0 },
        uMoonColor: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uMoonI: { value: 0 },
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
    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    const s = l.sky;
    (u.uDeep.value as THREE.Color).setRGB(...s.waterDeep);
    (u.uShallow.value as THREE.Color).setRGB(...s.waterShallow);
    (u.uHorizon.value as THREE.Color).setRGB(...s.horizon);
    (u.uZenith.value as THREE.Color).setRGB(...s.zenith);
    (u.uSunColor.value as THREE.Color).setRGB(...s.sunColor);
    (u.uSunDir.value as THREE.Vector3).copy(l.sunDir);
    u.uSunI.value = s.sunIntensity;
    (u.uMoonColor.value as THREE.Color).setRGB(...s.moonColor);
    (u.uMoonDir.value as THREE.Vector3).copy(l.moonDir);
    u.uMoonI.value = s.moonIntensity;
    u.uLamps.value = s.lamps;
  });

  return (
    <mesh material={material} rotation-x={-Math.PI / 2} position-y={WATER_LEVEL} receiveShadow={false}>
      {/* Fine enough for the curve to be smooth; flat maths near the island. */}
      <planeGeometry args={[900, 900, 150, 150]} />
    </mesh>
  );
}
