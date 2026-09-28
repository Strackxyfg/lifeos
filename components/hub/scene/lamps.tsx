"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PLAZA_LAMPS, WATERFRONT_LAMPS } from "@/lib/hub/island";
import { glowTexture, hubMaterials, lightScale, WINDOW_LIGHT } from "./materials";
import { useHubLight } from "./light";

const LAMPS = [...PLAZA_LAMPS, ...WATERFRONT_LAMPS];
const HEAD_Y = 1.22;

/**
 * Street lamps. By day, slim dark posts. From dusk, each head glows, a halo
 * forms around it and a warm pool of light spreads on the paving below — all
 * without a single real light source: dozens of point lights would cost
 * every pixel of every building, sprites cost almost nothing.
 */
export function Lamps() {
  const m = hubMaterials();
  const light = useHubLight();
  const posts = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  const halo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(LAMPS.flatMap(([x, z]) => [x, HEAD_Y, z])), 3));
    return g;
  }, []);
  const haloMaterial = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: glowTexture(),
        color: WINDOW_LIGHT,
        size: 1.5,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
        toneMapped: false,
      }),
    []
  );
  const poolMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: WINDOW_LIGHT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
        toneMapped: false,
      }),
    []
  );

  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    LAMPS.forEach(([x, z], i) => {
      o.position.set(x, 0.6, z);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      posts.current?.setMatrixAt(i, o.matrix);
      o.position.set(x, HEAD_Y, z);
      o.updateMatrix();
      heads.current?.setMatrixAt(i, o.matrix);
      o.position.set(x, 0.03, z);
      o.rotation.set(-Math.PI / 2, 0, 0);
      o.updateMatrix();
      pools.current?.setMatrixAt(i, o.matrix);
    });
    for (const mesh of [posts.current, heads.current, pools.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, []);

  const seen = useRef(-1);
  useFrame(() => {
    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    const lamps = l.sky.lamps;
    // Additive: the colour is the light. Scaled to the exposure like every lamp.
    const k = lightScale(l.atmo.exposure);
    haloMaterial.color.copy(WINDOW_LIGHT).multiplyScalar(k * 1.2);
    haloMaterial.opacity = lamps * 0.85;
    poolMaterial.color.copy(WINDOW_LIGHT).multiplyScalar(k * 1.1);
    poolMaterial.opacity = lamps * 0.55;
    if (pools.current) pools.current.visible = lamps > 0.01;
  });

  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, LAMPS.length]} material={m.metal} castShadow>
        <cylinderGeometry args={[0.03, 0.045, 1.2, 8]} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, LAMPS.length]} material={m.lampHead}>
        <sphereGeometry args={[0.09, 12, 10]} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, LAMPS.length]} material={poolMaterial} renderOrder={2}>
        <planeGeometry args={[3.4, 3.4]} />
      </instancedMesh>
      <points geometry={halo} material={haloMaterial} renderOrder={3} />
    </>
  );
}
