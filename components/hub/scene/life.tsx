"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { glowTexture, hubMaterials } from "./materials";
import { WATER_LEVEL } from "./water";

/* ── Boats ───────────────────────────────────────────────────────── */

function hullGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.95);
  s.quadraticCurveTo(0.36, 0.5, 0.36, -0.1);
  s.lineTo(0.3, -0.75);
  s.lineTo(-0.3, -0.75);
  s.lineTo(-0.36, -0.1);
  s.quadraticCurveTo(-0.36, 0.5, 0, 0.95);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
  // Shape plane x/y → x/−z, extruded upwards; then turned so the bow is +Z, "forward".
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  return g;
}

function Boat({ cabin = true }: { cabin?: boolean }) {
  const m = hubMaterials();
  const hull = useMemo(hullGeometry, []);
  return (
    <group>
      <mesh geometry={hull} material={m.white} castShadow />
      <mesh position={[0, 0.26, -0.2]} material={m.wood}>
        <boxGeometry args={[0.46, 0.02, 0.8]} />
      </mesh>
      {cabin && (
        <mesh position={[0, 0.4, 0.05]} material={m.navy} castShadow>
          <boxGeometry args={[0.4, 0.26, 0.42]} />
        </mesh>
      )}
    </group>
  );
}

const MOORED: { at: [number, number]; angle: number; cabin: boolean }[] = [
  { at: [-1.35, 10.4], angle: 0.08, cabin: true },
  { at: [1.35, 12.2], angle: -0.06, cabin: false },
];

/** Two boats moored at the jetty, bobbing; one tours the island, a wake behind it. */
export function Boats({ reducedMotion }: { reducedMotion: boolean }) {
  const moored = useRef<(THREE.Group | null)[]>([]);
  const cruiser = useRef<THREE.Group>(null);
  const wakeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: new THREE.Color("#ffffff"),
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    []
  );
  const clock = useRef(0);

  useFrame((_, dt) => {
    clock.current += reducedMotion ? 0 : Math.min(dt, 0.1);
    const t = clock.current;
    MOORED.forEach((b, i) => {
      const g = moored.current[i];
      if (!g) return;
      g.position.y = WATER_LEVEL - 0.1 + Math.sin(t * 1.3 + i * 2) * 0.03;
      g.rotation.z = Math.sin(t * 1.1 + i) * 0.04;
      g.rotation.x = Math.sin(t * 0.9 + i * 3) * 0.025;
    });
    const c = cruiser.current;
    if (c) {
      // A slow lap round the island, counter-clockwise seen from above.
      const a = t * 0.028 + 1.2;
      const x = Math.cos(a) * 22;
      const z = Math.sin(a) * 19;
      const dx = -Math.sin(a) * 22;
      const dz = Math.cos(a) * 19;
      c.position.set(x, WATER_LEVEL - 0.1 + Math.sin(t * 1.7) * 0.03, z);
      c.rotation.set(0, Math.atan2(dx, dz), Math.sin(t * 1.2) * 0.03);
    }
  });

  return (
    <>
      {MOORED.map((b, i) => (
        <group
          key={i}
          ref={(g) => {
            moored.current[i] = g;
          }}
          position={[b.at[0], WATER_LEVEL - 0.1, b.at[1]]}
          rotation-y={b.angle}
        >
          <Boat cabin={b.cabin} />
        </group>
      ))}
      <group ref={cruiser} scale={1.15}>
        <Boat />
        <mesh position={[0, 0.03, -1.9]} rotation-x={-Math.PI / 2} material={wakeMaterial}>
          <planeGeometry args={[0.9, 2.6]} />
        </mesh>
      </group>
    </>
  );
}
