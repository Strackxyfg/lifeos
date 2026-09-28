"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  BENCHES,
  CAUSEWAY,
  DOCK,
  FOUNTAIN,
  ISLET_OUTLINE,
  LAWNS,
  MAIN_OUTLINE,
  PATHS,
  PLAZA,
  seeded,
  type Point,
} from "@/lib/hub/island";
import { hubMaterials } from "./materials";
import { useHubLight } from "./light";
import { WATER_LEVEL } from "./water";

/**
 * A slab from an outline, its top at y = 0, its edge rounded like cast
 * concrete. The shape's plane is x/−z, extruded upwards once rotated.
 */
function slab(outline: readonly Point[], depth: number, bevel: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  // Top face (z = depth + bevel before the rotation) back to y = 0.
  g.translate(0, -(depth + bevel), 0);
  g.computeVertexNormals();
  return g;
}

/** A soft organic blob, for a lawn. */
function blob(at: Point, r: number, seed: number): Point[] {
  const rnd = seeded(seed * 97);
  const phase = rnd() * 6;
  return Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    const k = 1 + 0.1 * Math.sin(a * 2 + phase) + 0.06 * Math.sin(a * 3 + phase * 2);
    return [at[0] + Math.cos(a) * r * k, at[1] + Math.sin(a) * r * k] as Point;
  });
}

function segmentBox(from: Point, to: Point) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  return {
    length: Math.hypot(dx, dz),
    center: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as const,
    angle: Math.atan2(dx, dz),
  };
}

export function Ground({ reducedMotion }: { reducedMotion: boolean }) {
  const m = hubMaterials();
  const island = useMemo(() => slab(MAIN_OUTLINE, 1.3, 0.2), []);
  const islet = useMemo(() => slab(ISLET_OUTLINE, 0.9, 0.25), []);
  const lawns = useMemo(() => LAWNS.map((l) => slab(blob(l.at, l.r, l.seed), 0.06, 0.05)), []);
  const islandTop = useMemo(() => {
    const top = m.paving.clone();
    const map = m.paving.map!.clone();
    map.repeat.set(0.28, 0.28);
    map.needsUpdate = true;
    top.map = map;
    return top;
  }, [m]);

  const causeway = segmentBox(CAUSEWAY.from, CAUSEWAY.to);
  const dock = segmentBox(DOCK.from, DOCK.to);

  return (
    <group>
      {/* The island and the lighthouse rock. Group 0 = top and bottom, 1 = the sides. */}
      <mesh geometry={island} material={[islandTop, m.coast]} receiveShadow />
      <mesh geometry={islet} material={[m.rock, m.rock]} receiveShadow castShadow />
      <Boulders />

      {/* Causeway to the lighthouse. */}
      <mesh position={[causeway.center[0], -0.12, causeway.center[1]]} rotation-y={causeway.angle} material={m.coast} receiveShadow>
        <boxGeometry args={[CAUSEWAY.width, 0.3, causeway.length + 0.6]} />
      </mesh>

      {/* The jetty: a deck on posts. */}
      <group position={[dock.center[0], 0, dock.center[1]]} rotation-y={dock.angle}>
        <mesh position-y={0.02} material={m.wood} receiveShadow castShadow>
          <boxGeometry args={[DOCK.width, 0.12, dock.length]} />
        </mesh>
        {Array.from({ length: 5 }, (_, i) => {
          const z = -dock.length / 2 + 0.6 + (i * (dock.length - 1.2)) / 4;
          return [-1, 1].map((side) => (
            <mesh key={`${i}${side}`} position={[side * (DOCK.width / 2 - 0.06), (WATER_LEVEL - 0.4) / 2, z]} material={m.wood}>
              <cylinderGeometry args={[0.07, 0.07, 0.9, 8]} />
            </mesh>
          ));
        })}
      </group>

      {/* The plaza: paving inside a white kerb, a darker inner ring round the fountain. */}
      <mesh position={[PLAZA.center[0], 0.012, PLAZA.center[1]]} rotation-x={-Math.PI / 2} material={m.paving} receiveShadow>
        <circleGeometry args={[PLAZA.radius, 96]} />
      </mesh>
      <mesh position={[PLAZA.center[0], 0.02, PLAZA.center[1]]} rotation-x={-Math.PI / 2} material={m.trim} receiveShadow>
        <ringGeometry args={[PLAZA.radius, PLAZA.radius + 0.22, 96]} />
      </mesh>
      <mesh position={[PLAZA.center[0], 0.018, PLAZA.center[1]]} rotation-x={-Math.PI / 2} material={m.grey} receiveShadow>
        <ringGeometry args={[3.05, 3.18, 96]} />
      </mesh>

      {/* Paths from the plaza to each door. */}
      {PATHS.map((p, i) => {
        const s = segmentBox(p.from, p.to);
        return (
          <mesh key={i} position={[s.center[0], 0.008, s.center[1]]} rotation-y={s.angle} material={m.path} receiveShadow>
            <boxGeometry args={[p.width, 0.016, s.length]} />
          </mesh>
        );
      })}

      {lawns.map((g, i) => (
        <mesh key={i} geometry={g} material={[m.grass, m.grass]} position-y={0.1} receiveShadow />
      ))}

      <Fountain reducedMotion={reducedMotion} />

      {BENCHES.map((b, i) => (
        <group key={i} position={[b.at[0], 0, b.at[1]]} rotation-y={b.angle}>
          <mesh position-y={0.2} material={m.wood} castShadow receiveShadow>
            <boxGeometry args={[0.95, 0.07, 0.34]} />
          </mesh>
          <mesh position-y={0.09} material={m.white} castShadow>
            <boxGeometry args={[0.8, 0.18, 0.22]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Rocks round the lighthouse's islet, half in the water. */
function Boulders() {
  const m = hubMaterials();
  const rocks = useMemo(() => {
    const rnd = seeded(31);
    return ISLET_OUTLINE.filter((_, i) => i % 3 === 0).map(([x, z]) => ({
      at: [x + (rnd() - 0.5) * 0.4, WATER_LEVEL + 0.05, z + (rnd() - 0.5) * 0.4] as const,
      s: 0.25 + rnd() * 0.35,
      r: rnd() * Math.PI,
    }));
  }, []);
  return (
    <>
      {rocks.map((r, i) => (
        <mesh key={i} position={r.at} rotation={[r.r, r.r * 2, 0]} scale={r.s} material={m.rock} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
    </>
  );
}

const jetVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  varying float vFade;
  void main() {
    // Each drop: thrown up and out from the spout on its own clock, falling back.
    float life = 1.6;
    float t = mod(uTime + aSeed * life, life);
    float a = aSeed * 6.2831853 * 7.0;
    float out_ = 0.35 + fract(aSeed * 13.0) * 0.25;
    vec3 p = vec3(cos(a) * out_ * t, 0.95 + 2.1 * t - 1.9 * t * t, sin(a) * out_ * t);
    vFade = 1.0 - t / life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (26.0 / -mv.z) * (0.6 + vFade);
    gl_Position = projectionMatrix * mv;
  }
`;

const jetFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, (1.0 - d * 2.0) * vFade * uOpacity);
    #include <colorspace_fragment>
  }
`;

/** The fountain: a stone basin, a pool lit from below at night, and a living jet. */
function Fountain({ reducedMotion }: { reducedMotion: boolean }) {
  const m = hubMaterials();
  const light = useHubLight();
  const [cx, cz] = FOUNTAIN.center;
  const drops = useMemo(() => {
    const n = 180;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const seeds = new Float32Array(n);
    const rnd = seeded(3);
    for (let i = 0; i < n; i++) seeds[i] = rnd();
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    return g;
  }, []);
  const jet = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: jetVertex,
        fragmentShader: jetFragment,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#dff6ff") }, uOpacity: { value: 0.8 } },
      }),
    []
  );
  const clock = useRef(0);
  useFrame((_, dt) => {
    clock.current += reducedMotion ? dt * 0.25 : dt;
    jet.uniforms.uTime.value = clock.current;
    const lamps = light.current.sky.lamps;
    (jet.uniforms.uColor.value as THREE.Color).setRGB(0.8 + lamps * 0.1, 0.92, 1);
  });

  return (
    <group position={[cx, 0, cz]}>
      <mesh position-y={0.19} material={m.white} castShadow receiveShadow>
        <cylinderGeometry args={[FOUNTAIN.radius, FOUNTAIN.radius + 0.06, 0.38, 64]} />
      </mesh>
      <mesh position-y={0.39} rotation-x={-Math.PI / 2} material={m.pool}>
        <circleGeometry args={[FOUNTAIN.radius - 0.14, 64]} />
      </mesh>
      <mesh position-y={0.55} material={m.white} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 0.5, 24]} />
      </mesh>
      <mesh position-y={0.82} material={m.white} castShadow>
        <cylinderGeometry args={[0.46, 0.3, 0.1, 32]} />
      </mesh>
      <points geometry={drops} material={jet} frustumCulled={false} />
    </group>
  );
}
