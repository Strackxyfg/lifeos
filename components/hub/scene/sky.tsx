"use client";

import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useHubLight } from "./light";
import { horizonDip } from "./water";

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Pinned to the far plane: the sky is always behind everything.
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uSunVisible;
  uniform float uMoonVisible;
  uniform float uStars;
  uniform float uTime;
  uniform float uDip;
  uniform vec3 uCloudLight;
  uniform vec3 uCloudShade;
  uniform float uCloudOpacity;
  uniform float uMotion;
  varying vec3 vDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec2(11.7, 5.3);
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    // The sea curves away below the horizontal, like a small planet's: the
    // sky's own horizon is lowered to meet it. Sun, moon and stars keep
    // their true heights above that horizon.
    float el = asin(clamp(d.y, -1.0, 1.0)) + uDip;
    el = min(el, 1.5707);
    float az = atan(d.x, -d.z);
    vec3 v = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
    float h = v.y;
    float up = clamp(h, 0.0, 1.0);

    vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
    col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.25, h));

    // Glow around the sun, widest near the horizon, where the air is thickest.
    float cs = max(dot(v, uSunDir), 0.0);
    float nearHorizon = 1.0 - smoothstep(0.0, 0.45, up);
    float glow = pow(cs, 7.0) * (0.3 + 0.7 * nearHorizon) + pow(cs, 120.0) * 0.6;
    col = mix(col, uGlow, clamp(glow, 0.0, 1.0) * (0.35 + 0.65 * uSunVisible));

    // Stars: one in a few hundred cells of a grid on the sphere, twinkling.
    if (uStars > 0.001 && h > 0.0) {
      vec3 cell = floor(v * 150.0);
      float r = hash13(cell);
      if (r > 0.9955) {
        vec3 c = normalize((cell + 0.5) / 150.0);
        float dist = length(v - c) * 150.0;
        float star = smoothstep(0.5, 0.0, dist);
        float twinkle = 0.65 + 0.35 * sin(uTime * (1.3 + r * 2.7) + r * 71.0);
        float bright = 0.45 + 0.55 * fract(r * 17.0);
        col += vec3(0.92, 0.95, 1.0) * star * twinkle * bright * uStars * smoothstep(0.0, 0.3, h);
      }
    }

    // The moon: a disc lit on the side that faces the sun — its phase, from geometry.
    float moonR = 0.026;
    float cm = dot(v, uMoonDir);
    if (uMoonVisible > 0.001 && cm > cos(moonR)) {
      vec3 q = v - uMoonDir * cm;
      float lq = max(length(q), 1e-6);
      float rho = clamp(lq / sin(moonR), 0.0, 1.0);
      vec3 n = (q / lq) * rho - uMoonDir * sqrt(max(0.0, 1.0 - rho * rho));
      float lit = smoothstep(-0.04, 0.08, dot(n, uSunDir));
      float edge = smoothstep(1.0, 0.9, rho);
      vec3 moon = mix(uZenith * 1.15 + vec3(0.02), vec3(0.95, 0.94, 0.88), lit);
      col = mix(col, moon, edge * uMoonVisible);
    }

    // A layer of cumulus, drifting; lit by the sun of the moment.
    if (h > 0.0) {
      vec2 cp = v.xz / (h + 0.09) * 0.55 + vec2(uTime * 0.006 * uMotion, uTime * 0.002 * uMotion);
      float n = fbm(cp);
      float cover = smoothstep(0.5, 0.74, n) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.45, 0.9, h));
      vec3 cloud = mix(uCloudShade, uCloudLight, smoothstep(0.52, 0.86, n));
      cloud = mix(cloud, uGlow, pow(cs, 5.0) * 0.45 * (1.0 - smoothstep(0.0, 0.3, h)));
      col = mix(col, cloud, cover * uCloudOpacity);
    }

    // The sun's disc, over its clouds' edges — larger than the true half degree, so it reads.
    float disc = smoothstep(0.99955, 0.99978, dot(v, uSunDir));
    col += uSunColor * disc * 2.5 * uSunVisible;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The sky dome: gradient, sun, clouds, stars and the moon in its real phase.
 * It follows the camera, and lowers its horizon to meet the curved sea.
 */
export const SkyDome = memo(function SkyDome({ reducedMotion }: { reducedMotion: boolean }) {
  const light = useHubLight();
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uGlow: { value: new THREE.Color() },
          uSunColor: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
          uSunVisible: { value: 1 },
          uMoonVisible: { value: 0 },
          uStars: { value: 0 },
          uTime: { value: 0 },
          uDip: { value: 0.3 },
          uCloudLight: { value: new THREE.Color() },
          uCloudShade: { value: new THREE.Color() },
          uCloudOpacity: { value: 0.8 },
          uMotion: { value: 1 },
        },
      }),
    []
  );
  const seen = useRef(-1);
  const lastCamera = useRef(new THREE.Vector3(Infinity, 0, 0));
  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }) => {
    mesh.current?.position.copy(camera.position);
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uMotion.value = reducedMotion ? 0.2 : 1;

    // Where the curved sea's edge is from here: recomputed only when the camera moved.
    if (camera.position.distanceToSquared(lastCamera.current) > 1e-4) {
      lastCamera.current.copy(camera.position);
      camera.getWorldDirection(forward);
      const len = Math.hypot(forward.x, forward.z) || 1;
      const dip = horizonDip(camera.position.x, camera.position.y, camera.position.z, forward.x / len, forward.z / len);
      u.uDip.value = (dip * Math.PI) / 180;
    }

    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    const s = l.sky;
    (u.uZenith.value as THREE.Color).setRGB(...s.zenith);
    (u.uHorizon.value as THREE.Color).setRGB(...s.horizon);
    (u.uGlow.value as THREE.Color).setRGB(...s.sunGlow);
    (u.uSunColor.value as THREE.Color).setRGB(...s.sunColor);
    (u.uSunDir.value as THREE.Vector3).copy(l.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(l.moonDir);
    u.uSunVisible.value = THREE.MathUtils.smoothstep(l.sun.elevation, -1.2, 0.6);
    // Faint by day, bright at night, gone below the horizon.
    u.uMoonVisible.value = THREE.MathUtils.smoothstep(l.moon.elevation, -0.5, 1.5) * (0.3 + 0.7 * s.stars);
    u.uStars.value = s.stars;

    // Clouds: white at noon, gilded at the ends of the day, dim at night.
    const day = Math.min(1, s.sunIntensity / 2.4);
    const lightColor = new THREE.Color(1, 1, 1).lerp(new THREE.Color().setRGB(...s.sunGlow), 0.55 * (1 - day));
    lightColor.multiplyScalar(0.28 + 0.72 * (1 - s.stars * 0.85));
    (u.uCloudLight.value as THREE.Color).copy(lightColor);
    const shade = new THREE.Color().setRGB(...s.horizon).lerp(new THREE.Color().setRGB(...s.zenith), 0.45).multiplyScalar(0.82);
    (u.uCloudShade.value as THREE.Color).copy(shade);
    u.uCloudOpacity.value = 0.85 - 0.35 * s.stars;
  });

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-10}>
      <sphereGeometry args={[500, 64, 32]} />
    </mesh>
  );
});
