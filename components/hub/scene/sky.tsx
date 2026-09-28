"use client";

import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useHubLight } from "./light";
import { EQUIRECT_GLSL, useSkyMap } from "./atmosphere";
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
  uniform sampler2D uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunDisc;
  uniform vec3 uMoonDir;
  uniform vec3 uSunForMoon;
  uniform float uMoonVisible;
  uniform vec3 uMoonDisc;
  uniform float uStars;
  uniform float uTime;
  uniform float uDip;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec3 uSilver;
  uniform float uCloudOpacity;
  uniform float uMotion;
  varying vec3 vDir;

  ${EQUIRECT_GLSL}

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
    for (int i = 0; i < 6; i++) {
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

    // The sky's radiance, computed from the physics for this sun and moon.
    vec3 col = texture2D(uSky, skyUv(vec3(v.x, max(h, 0.0), v.z))).rgb;

    // Stars: one in a few hundred cells of a grid on the sphere, twinkling.
    if (uStars > 0.001 && h > 0.0) {
      vec3 cell = floor(v * 150.0);
      float r = hash13(cell);
      if (r > 0.9955) {
        vec3 c = normalize((cell + 0.5) / 150.0);
        float dist = length(v - c) * 150.0;
        float star = smoothstep(0.5, 0.0, dist);
        float twinkle = 0.65 + 0.35 * sin(uTime * (1.3 + r * 2.7) + r * 71.0);
        float bright = 0.3 + 0.7 * pow(fract(r * 17.0), 3.0);
        // Extinction near the horizon, as through more air.
        col += vec3(0.92, 0.95, 1.0) * 0.05 * star * twinkle * bright * uStars * smoothstep(0.0, 0.3, h);
      }
    }

    // The moon: a disc lit on the side that faces the sun — its phase, from geometry.
    float moonR = 0.012;
    float cm = dot(v, uMoonDir);
    if (uMoonVisible > 0.001 && cm > cos(moonR * 1.2)) {
      vec3 q = v - uMoonDir * cm;
      float lq = max(length(q), 1e-6);
      float rho = clamp(lq / sin(moonR), 0.0, 1.0);
      vec3 n = (q / lq) * rho - uMoonDir * sqrt(max(0.0, 1.0 - rho * rho));
      float lit = smoothstep(-0.04, 0.08, dot(n, uSunForMoon));
      // Maria: darker patches, so it reads as the moon and not a lamp.
      float maria = 0.78 + 0.22 * smoothstep(0.35, 0.65, vnoise(q.xy / sin(moonR) * 2.2 + 3.0));
      float edge = smoothstep(1.0, 0.94, rho);
      col += uMoonDisc * lit * maria * edge * uMoonVisible;
    }

    // Cumulus, drifting: lit by the sun of the moment, shaded by the sky,
    // silver-edged towards the sun, and hazed towards the horizon.
    if (h > 0.0) {
      vec2 cp = v.xz / (h + 0.09) * 0.55 + vec2(uTime * 0.006 * uMotion, uTime * 0.002 * uMotion);
      float n = fbm(cp);
      float cover = smoothstep(0.5, 0.74, n) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.45, 0.9, h));
      // Thicker cores are darker underneath; thin edges let the sun through.
      float thick = smoothstep(0.55, 0.9, n);
      float toSun = max(dot(v, uSunDir), 0.0);
      vec3 cloud = mix(uCloudLit, uCloudShade, thick * 0.65);
      cloud += uSilver * pow(toSun, 8.0) * (1.0 - thick);
      vec3 haze = texture2D(uSky, skyUv(vec3(v.x, 0.0, v.z))).rgb;
      cloud = mix(cloud, haze, 1.0 - smoothstep(0.0, 0.35, h));
      col = mix(col, cloud, cover * uCloudOpacity);
    }

    // The sun's disc, over its clouds' edges — larger than the true half
    // degree, so it reads; its limb darkened, as the real one is.
    float cs = dot(v, uSunDir);
    float disc = smoothstep(0.99955, 0.99978, cs);
    float limb = 0.6 + 0.4 * smoothstep(0.99955, 0.99995, cs);
    col += uSunDisc * disc * limb;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * The sky dome: the physical sky's radiance (`SkyProvider`), the sun's disc,
 * clouds, stars and the moon in its real phase. It follows the camera, and
 * lowers its horizon to meet the curved sea.
 */
export const SkyDome = memo(function SkyDome({ reducedMotion }: { reducedMotion: boolean }) {
  const light = useHubLight();
  const sky = useSkyMap();
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uSky: { value: null },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunDisc: { value: new THREE.Vector3() },
          uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
          uSunForMoon: { value: new THREE.Vector3(0, 1, 0) },
          uMoonVisible: { value: 0 },
          uMoonDisc: { value: new THREE.Vector3() },
          uStars: { value: 0 },
          uTime: { value: 0 },
          uDip: { value: 0.3 },
          uCloudLit: { value: new THREE.Vector3() },
          uCloudShade: { value: new THREE.Vector3() },
          uSilver: { value: new THREE.Vector3() },
          uCloudOpacity: { value: 0.8 },
          uMotion: { value: 1 },
        },
      }),
    []
  );
  const seen = useRef(-1);
  const seenSky = useRef(-1);
  const lastCamera = useRef(new THREE.Vector3(Infinity, 0, 0));
  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }) => {
    mesh.current?.position.copy(camera.position);
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uMotion.value = reducedMotion ? 0.2 : 1;
    if (sky.current.version !== seenSky.current) {
      seenSky.current = sky.current.version;
      u.uSky.value = sky.current.texture;
    }
    if (mesh.current) mesh.current.visible = sky.current.texture !== null;

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
    const a = l.atmo;
    (u.uSunDir.value as THREE.Vector3).copy(l.sunDir);
    // The disc's radiance: the sunlight that crosses the air, spread over the
    // (enlarged) disc — capped, a display cannot show the sun anyway; the
    // bloom does the rest.
    const disc = Math.min(40, 12 * Math.max(a.sun[0], a.sun[1], a.sun[2])) / Math.max(1e-6, Math.max(a.sun[0], a.sun[1], a.sun[2]));
    (u.uSunDisc.value as THREE.Vector3).set(a.sun[0] * disc, a.sun[1] * disc, a.sun[2] * disc);
    (u.uMoonDir.value as THREE.Vector3).copy(l.moonDir);
    (u.uSunForMoon.value as THREE.Vector3).copy(l.sunDir);
    u.uMoonVisible.value = THREE.MathUtils.smoothstep(l.moon.elevation, -0.5, 1.5);
    // The moon's surface: grey rock under full sunlight — far brighter than
    // the night sky, a little brighter than the day's.
    (u.uMoonDisc.value as THREE.Vector3).set(0.46, 0.45, 0.42);
    u.uStars.value = s.stars;

    // Clouds: white under the sun, lit by the sky from beneath; the ends of
    // the day colour them through the sunlight itself.
    const albedo = 0.8 / Math.PI;
    const sunUp = Math.max(0.15, l.sunDir.y);
    const lit: [number, number, number] = [0, 1, 2].map((c) => albedo * (a.sun[c] * (0.35 + 0.65 * sunUp) + a.skyUp[c] + a.moon[c] * 0.6)) as [number, number, number];
    (u.uCloudLit.value as THREE.Vector3).set(...lit);
    const shade = [0, 1, 2].map((c) => albedo * (a.skyUp[c] * 0.8 + a.sun[c] * 0.08)) as [number, number, number];
    (u.uCloudShade.value as THREE.Vector3).set(...shade);
    (u.uSilver.value as THREE.Vector3).set(a.sun[0] * 0.5, a.sun[1] * 0.5, a.sun[2] * 0.5);
    // Thinner clouds at night: they would only be dark shapes.
    u.uCloudOpacity.value = 0.85 - 0.4 * s.stars;
  });

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-10}>
      <sphereGeometry args={[500, 64, 32]} />
    </mesh>
  );
});
