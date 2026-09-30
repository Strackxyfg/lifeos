"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CEREBELLUM, STEM, cerebrum, folia } from "@/lib/hub/brain-shape";
import { seeded } from "@/lib/hub/island";
import { useHubLight } from "./light";
import { backlight, hubMaterials, lightScale } from "./materials";
import { clearLocalLights, setLocalLights } from "./interior-lights";
import { addShaderHook, withLift } from "./lift";

/**
 * The second brain's crystal brain, lit from within, under its glass dome.
 *
 * Drawn back to front, so each layer shows through the one in front:
 *   1. the crystal's inner surface (its back faces), glowing — the light
 *      inside;
 *   2. neurons: points spread through its volume, each breathing on its own
 *      rhythm;
 *   3. its outer surface, as clear crystal: by the Fresnel law it reflects
 *      the sky at a grazing angle and lets the inside show straight on, with
 *      a rim of light where the surface turns away;
 *   4. the dome (window glass, `glass.ts`) over it all.
 * The folds glow more than the crests — the crystal is thinner there — and
 * slow signals sweep along them. A lit plinth under it throws its light on
 * the floor of the dome, as a lamp of the building (`interior-lights.ts`).
 *
 * Its light follows the building's own (`backlight`): on by day, weaker
 * than at night, as a lit room's.
 */

/** The glow's colour: the product's blue, a little towards cyan. */
const GLOW = new THREE.Color("#63b3ff");
const WHITE = new THREE.Color(1, 1, 1);
/** The share of its night glow the brain keeps by day. */
const CRYSTAL_DAY = 0.6;
/** Seconds, for the signals and the neurons. One clock for both. */
const TIME = { value: 0 };

/** Where the brain floats, in the rotunda's frame, and its size. */
const CENTRE: [number, number, number] = [0, 5.02, 0];
const SCALE = 1.22;
/** The top of the drum under the dome, where the plinth stands. */
const FLOOR_Y = 3.82;

function withFold(g: THREE.BufferGeometry, fold: (i: number) => number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fold(i);
  g.setAttribute("aFold", new THREE.BufferAttribute(a, 1));
  return g;
}

/** Cerebrum, cerebellum and stem, merged: one draw per pass. Positions in brain units. */
export function crystalGeometry(detail = 40): THREE.BufferGeometry {
  // The cerebrum: a sphere, each vertex moved out to the brain's surface.
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const cer = mergeVertices(ico);
  ico.dispose();
  {
    const pos = cer.attributes.position as THREE.BufferAttribute;
    const folds: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const len = Math.hypot(x, y, z) || 1;
      const p = cerebrum(x, y, z);
      pos.setXYZ(i, (x / len) * p.radius, (y / len) * p.radius, (z / len) * p.radius);
      folds.push(p.fold);
    }
    withFold(cer, (i) => folds[i]);
    cer.computeVertexNormals();
  }

  // The cerebellum: an ellipsoid with its fine, nearly horizontal folia.
  const sph = new THREE.SphereGeometry(1, 72, 40);
  sph.deleteAttribute("normal");
  sph.deleteAttribute("uv");
  const cbl = mergeVertices(sph);
  sph.dispose();
  {
    const pos = cbl.attributes.position as THREE.BufferAttribute;
    const folds: number[] = [];
    const [cx, cy, cz] = CEREBELLUM.at;
    const [sx, sy, sz] = CEREBELLUM.size;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const f = folia(y, z);
      const r = 1 - 0.07 * f;
      pos.setXYZ(i, cx + x * sx * r, cy + y * sy * r, cz + z * sz * r);
      folds.push(0.15 + 0.8 * f);
    }
    withFold(cbl, (i) => folds[i]);
    cbl.computeVertexNormals();
  }

  // The stem: a tapered cylinder from under the middle, down and back.
  const top = new THREE.Vector3(...STEM.top);
  const bottom = new THREE.Vector3(...STEM.bottom);
  const axis = top.clone().sub(bottom);
  const stem = new THREE.CylinderGeometry(STEM.radius[0], STEM.radius[1], axis.length(), 28, 4, true);
  stem.deleteAttribute("uv");
  stem.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize()));
  stem.translate((top.x + bottom.x) / 2, (top.y + bottom.y) / 2, (top.z + bottom.z) / 2);
  withFold(stem, () => 0.4);

  const merged = mergeGeometries([cer, cbl, stem], false);
  cer.dispose();
  cbl.dispose();
  stem.dispose();
  if (!merged) throw new Error("crystal brain: geometries did not merge");
  return merged;
}

/**
 * Crystal as glass behaves (see `glass.ts` for the reasoning): premultiplied,
 * the surface's own light at full strength and an alpha that is the share of
 * what lies behind it held back — Fresnel reflectance plus absorption. The
 * glow is emission, so it adds whatever the angle.
 */
function crystalMaterial(inner: boolean): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: inner ? "#0a1430" : "#d5e6ff",
    metalness: 0,
    roughness: inner ? 0.4 : 0.05,
    ior: 1.55,
    specularIntensity: 1,
    clearcoat: inner ? 0 : 1,
    clearcoatRoughness: 0.04,
    iridescence: inner ? 0 : 0.45,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 520],
    emissive: GLOW,
    emissiveIntensity: 0,
    envMapIntensity: inner ? 0.3 : 0.75,
    transparent: true,
    depthWrite: false,
    side: inner ? THREE.BackSide : THREE.FrontSide,
  });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  // The path tracer takes the outer surface as glowing, transmissive crystal
  // and leaves the inner one out (it has no use for a second skin).
  if (inner) m.userData.traceSkip = true;
  else m.userData.traceCrystal = { color: "#dfeaff", ior: 1.55, roughness: 0.05 };
  const f0 = ((1.55 - 1) / (1.55 + 1)) ** 2;
  return addShaderHook(m, inner ? "crystal-inner" : "crystal-outer", (shader) => {
    shader.uniforms.uCrystalTime = TIME;
    shader.uniforms.uCrystalF0 = { value: f0 };
    shader.uniforms.uCrystalAbsorb = { value: inner ? 0.28 : 0.06 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFold;\nvarying float vFold;\nvarying vec3 vCrystal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFold = aFold;\nvCrystal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uCrystalTime;\nuniform float uCrystalF0;\nuniform float uCrystalAbsorb;\nvarying float vFold;\nvarying vec3 vCrystal;"
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        // Thinner in the folds: the light inside shows through more there.
        float crystalGlow = mix(0.18, 1.0, vFold);
        // Slow signals sweeping along the folds.
        float crystalWave = 0.5 + 0.5 * sin(dot(vCrystal, vec3(0.9, 0.45, 1.35)) * 7.0 - uCrystalTime * 1.6);
        float crystalSignal = pow(crystalWave, 14.0) * smoothstep(0.45, 0.95, vFold);
        totalEmissiveRadiance *= (crystalGlow + 2.4 * crystalSignal) * mix(vec3(0.82, 0.86, 1.12), vec3(0.78, 1.08, 1.06), vFold);`
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        float crystalNoV = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
        float crystalF = uCrystalF0 + (1.0 - uCrystalF0) * pow(1.0 - crystalNoV, 5.0);
        ${inner ? "" : "// A rim of light where the surface turns away from the eye.\n        outgoingLight += emissive * pow(1.0 - crystalNoV, 3.0) * 0.9;"}
        gl_FragColor = vec4(outgoingLight, clamp(crystalF + uCrystalAbsorb, 0.0, 1.0));`
      );
  });
}

const neuronVertex = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uSize;
  varying float vPulse;
  void main() {
    vPulse = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase * 6.2831853);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (0.6 + 0.6 * vPulse) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const neuronFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vPulse;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = pow(1.0 - d * 2.0, 1.6) * uOpacity * vPulse;
    // Additive blending weighs the colour by alpha itself.
    gl_FragColor = vec4(mix(uColor, vec3(1.0), vPulse * 0.4), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Neurons inside the crystal: points spread through the brain's volume, not on its surface. */
function neuronGeometry(count = 700): THREE.BufferGeometry {
  const rnd = seeded(77);
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(t);
    const dy = u;
    const dz = s * Math.sin(t);
    // Most of them in the outer third, where the cortex is.
    const r = cerebrum(dx, dy, dz).radius * (0.35 + 0.55 * Math.sqrt(rnd()));
    pos[i * 3] = dx * r;
    pos[i * 3 + 1] = dy * r;
    pos[i * 3 + 2] = dz * r;
    phase[i] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  return g;
}

export function CrystalBrain({ reducedMotion }: { reducedMotion: boolean }) {
  const light = useHubLight();
  const spin = useRef<THREE.Group>(null);
  const anchor = useRef<THREE.Group>(null);
  const seen = useRef(-1);
  const m = hubMaterials();

  const geometry = useMemo(() => crystalGeometry(), []);
  const neurons = useMemo(() => neuronGeometry(), []);
  const inner = useMemo(() => crystalMaterial(true), []);
  const outer = useMemo(() => crystalMaterial(false), []);
  const neuronMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: neuronVertex,
        fragmentShader: neuronFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: TIME,
          uSize: { value: 44 },
          uColor: { value: new THREE.Color("#9fd0ff") },
          uOpacity: { value: 0.8 },
        },
      }),
    []
  );
  // Merged with the building (`batch.ts`): it must rise with it when hovered.
  const plinthGlow = useMemo(() => withLift(new THREE.MeshBasicMaterial({ color: GLOW.clone() })), []);
  const lamp = useMemo(() => [new THREE.Vector3()], []);

  useEffect(
    () => () => {
      geometry.dispose();
      neurons.dispose();
      inner.dispose();
      outer.dispose();
      neuronMaterial.dispose();
      plinthGlow.dispose();
      clearLocalLights("brain-core");
    },
    [geometry, neurons, inner, outer, neuronMaterial, plinthGlow]
  );

  useFrame(({ clock }, dt) => {
    TIME.value = clock.elapsedTime;
    if (spin.current && !reducedMotion) spin.current.rotation.y += dt * 0.12;
    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    // The brain is a light, not a room: by day it keeps more of its night
    // glow than the buildings' rooms (`backlight`), or the sky's reflection
    // on the crystal leaves it looking frosted, unlit.
    const lit = Math.max(CRYSTAL_DAY, backlight(l.sky.lamps));
    const level = lit * lightScale(l.atmo.exposure);
    inner.emissiveIntensity = 1.8 * level;
    outer.emissiveIntensity = 0.7 * level;
    neuronMaterial.uniforms.uOpacity.value = 0.85 * level;
    // By day the plinth's light reads paler, as a lit lens in daylight does.
    plinthGlow.color.copy(GLOW).lerp(WHITE, 0.45 * (1 - l.sky.lamps)).multiplyScalar(1.4 * level);
    // Its light on the floor of the dome, from the top of the plinth.
    const a = anchor.current;
    if (a) {
      a.updateWorldMatrix(true, false);
      lamp[0].set(0, FLOOR_Y + 0.45, 0).applyMatrix4(a.matrixWorld);
      setLocalLights("brain-core", lamp, GLOW, 5 * level);
    }
  });

  return (
    <group ref={anchor}>
      {/* The floor under the dome, lit by the brain; the plinth it floats over. */}
      <mesh position-y={FLOOR_Y + 0.004} rotation-x={-Math.PI / 2} material={m.floorStone} receiveShadow>
        <circleGeometry args={[2.68, 72]} />
      </mesh>
      <mesh position-y={FLOOR_Y + 0.08} material={m.trim} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.58, 0.16, 48]} />
      </mesh>
      <mesh position-y={FLOOR_Y + 0.162} rotation-x={-Math.PI / 2} material={plinthGlow} userData={{ traceEmissive: "#63b3ff" }}>
        <circleGeometry args={[0.42, 48]} />
      </mesh>
      <group position={CENTRE} scale={SCALE}>
        <group ref={spin} userData={{ dynamic: true }}>
          <mesh geometry={geometry} material={inner} renderOrder={2} />
          <points geometry={neurons} material={neuronMaterial} renderOrder={2.5} />
          <mesh geometry={geometry} material={outer} renderOrder={3} />
        </group>
      </group>
    </group>
  );
}
