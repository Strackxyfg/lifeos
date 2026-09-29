"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { seeded } from "@/lib/hub/island";
import { useHubLight } from "./light";

/**
 * Gulls over the harbour and round the lighthouse: they glide on wide
 * circles, bank into their turns, beat their wings in short bursts and
 * glide again. They roost at night.
 */

interface Gull {
  center: [number, number];
  radius: number;
  height: number;
  speed: number;
  phase: number;
  /** Some circle one way, some the other. */
  dir: 1 | -1;
  flapSeed: number;
}

const COUNT = 7;

function flock(): Gull[] {
  const rnd = seeded(808);
  const centres: [number, number][] = [
    [4, 14],
    [12.5, 10.5],
    [-3, 13],
    [8, 16],
  ];
  return Array.from({ length: COUNT }, (_, i) => ({
    center: centres[i % centres.length],
    radius: 2.2 + rnd() * 3,
    height: 3.2 + rnd() * 2.8,
    speed: 0.9 + rnd() * 0.5,
    phase: rnd() * Math.PI * 2,
    dir: rnd() < 0.5 ? 1 : -1,
    flapSeed: rnd() * 100,
  }));
}

/** Wing beat: bursts of flapping between long glides. */
function flap(t: number, seed: number): number {
  const cycle = 6 + (seed % 3);
  const u = (t + seed) % cycle;
  if (u > 1.6) return 0.12 + 0.03 * Math.sin(t * 2 + seed);
  // Beating: about four beats a second, fading in and out of the burst.
  const env = Math.sin((u / 1.6) * Math.PI);
  return 0.1 + env * 0.75 * Math.sin(t * 26 + seed);
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _w = new THREE.Matrix4();
const _wm = new THREE.Matrix4();
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export function Birds({ reducedMotion }: { reducedMotion: boolean }) {
  const light = useHubLight();
  const gulls = useMemo(flock, []);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const wings = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const body = new THREE.SphereGeometry(0.05, 10, 8);
    body.scale(0.55, 0.5, 1.5);
    // A wing: a long thin plate hinged at the body (x = 0), swept back a touch.
    const wing = new THREE.BoxGeometry(0.2, 0.006, 0.055);
    wing.translate(0.1, 0, -0.01);
    const pos = wing.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0.15) pos.setZ(i, pos.getZ(i) - 0.025);
    wing.computeVertexNormals();
    return { body, wing };
  }, []);
  const materials = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ color: "#f4f4f2", roughness: 0.7 }),
      wing: new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.7, side: THREE.DoubleSide }),
    }),
    []
  );
  useEffect(
    () => () => {
      geo.body.dispose();
      geo.wing.dispose();
      materials.body.dispose();
      materials.wing.dispose();
    },
    [geo, materials]
  );
  const clock = useRef(0);

  useFrame((_, dt) => {
    const b = bodies.current;
    const w = wings.current;
    if (!b || !w) return;
    clock.current += reducedMotion ? 0 : Math.min(dt, 0.1);
    const t = clock.current;
    const roosting = light.current.sky.lamps > 0.6;
    gulls.forEach((g, i) => {
      if (roosting) {
        b.setMatrixAt(i, HIDDEN);
        w.setMatrixAt(i * 2, HIDDEN);
        w.setMatrixAt(i * 2 + 1, HIDDEN);
        return;
      }
      const a = g.phase + (t * g.speed * g.dir) / g.radius;
      const x = g.center[0] + Math.cos(a) * g.radius;
      const z = g.center[1] + Math.sin(a) * g.radius;
      const y = g.height + Math.sin(t * 0.4 + g.phase) * 0.35;
      // Flying along the circle's tangent, banked into the turn.
      const heading = Math.atan2(-Math.sin(a) * g.dir, Math.cos(a) * g.dir);
      const bank = -0.45 * g.dir;
      _e.set(0, heading, bank, "YXZ");
      _q.setFromEuler(_e);
      _p.set(x, y, z);
      _m.compose(_p, _q, _s);
      b.setMatrixAt(i, _m);
      const beat = flap(t, g.flapSeed);
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? 1 : -1;
        _w.makeRotationZ(side * beat);
        // The right wing is the left one mirrored.
        if (side < 0) _w.multiply(MIRROR);
        w.setMatrixAt(i * 2 + s, _wm.copy(_m).multiply(_w));
      }
    });
    b.instanceMatrix.needsUpdate = true;
    w.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bodies} args={[geo.body, materials.body, COUNT]} frustumCulled={false} />
      <instancedMesh ref={wings} args={[geo.wing, materials.wing, COUNT * 2]} frustumCulled={false} />
    </>
  );
}
