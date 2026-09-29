"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TREES, seeded } from "@/lib/hub/island";
import { hubMaterials, wind } from "./materials";

/**
 * The island's trees, instanced: one draw call per part (trunks, round
 * crowns, cypresses) however many trees there are. They never move, so their
 * matrices are written once.
 */
export function Trees({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const m = hubMaterials();
  // The wind's clock: slowed right down, not stopped, when motion should be reduced.
  useFrame((_, dt) => {
    wind.value += Math.min(dt, 0.1) * (reducedMotion ? 0.15 : 1);
  });
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const cypresses = useRef<THREE.InstancedMesh>(null);

  const round = useMemo(() => TREES.filter((t) => t.kind === "round"), []);
  const tall = useMemo(() => TREES.filter((t) => t.kind === "cypress"), []);

  const crownGeometry = useMemo(() => {
    // A slightly lumpy crown reads as foliage; a perfect sphere reads as a ball.
    const g = new THREE.IcosahedronGeometry(0.62, 2);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const rnd = seeded(11);
    const bumps = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let k = bumps.get(key);
      if (k === undefined) {
        k = 0.9 + rnd() * 0.2;
        bumps.set(key, k);
      }
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.92, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    const rnd = seeded(23);
    TREES.forEach((t, i) => {
      o.position.set(t.at[0], 0.32 * t.scale, t.at[1]);
      o.rotation.set(0, 0, 0);
      o.scale.set(t.scale, t.scale * (t.kind === "cypress" ? 0.8 : 1), t.scale);
      o.updateMatrix();
      trunks.current?.setMatrixAt(i, o.matrix);
    });
    round.forEach((t, i) => {
      o.position.set(t.at[0], 1.05 * t.scale, t.at[1]);
      o.rotation.set(0, rnd() * Math.PI * 2, 0);
      o.scale.setScalar(t.scale);
      o.updateMatrix();
      crowns.current?.setMatrixAt(i, o.matrix);
    });
    tall.forEach((t, i) => {
      o.position.set(t.at[0], 1.25 * t.scale, t.at[1]);
      o.rotation.set(0, 0, 0);
      o.scale.set(t.scale * 0.34, t.scale * 1.15, t.scale * 0.34);
      o.updateMatrix();
      cypresses.current?.setMatrixAt(i, o.matrix);
    });
    for (const mesh of [trunks.current, crowns.current, cypresses.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [round, tall]);

  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, TREES.length]} material={m.trunk} castShadow receiveShadow>
        <cylinderGeometry args={[0.06, 0.09, 0.64, 8]} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[crownGeometry, undefined, round.length]} material={m.leaf} castShadow receiveShadow />
      <instancedMesh ref={cypresses} args={[undefined, undefined, tall.length]} material={m.cypress} castShadow receiveShadow>
        <sphereGeometry args={[1, 14, 12]} />
      </instancedMesh>
    </>
  );
}
