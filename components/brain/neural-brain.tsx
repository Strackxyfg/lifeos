"use client";

import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";

/**
 * Procedurally builds a brain-shaped point cloud: two wrinkled cerebral
 * hemispheres split by a longitudinal fissure, a finely-folded cerebellum at
 * the lower-back, and a short brain stem. Also derives short "circuit" lines
 * between nearby points and a set of pulsing neuron nodes.
 */
function buildBrain() {
  const positions: number[] = [];
  const all: [number, number, number][] = [];
  const push = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    all.push([x, y, z]);
  };

  // Cerebrum — two hemispheres on a wrinkled ellipsoid shell.
  const CEREBRUM = 1600;
  for (let i = 0; i < CEREBRUM; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = Math.acos(2 * u - 1);
    const phi = 2 * Math.PI * v;
    let r =
      1 +
      0.05 * Math.sin(6 * phi) * Math.sin(5 * theta) +
      0.04 * Math.sin(9 * theta) +
      0.03 * Math.sin(7 * phi + 1.5);
    r *= 0.9 + Math.random() * 0.06; // shell thickness inward
    const x = r * Math.sin(theta) * Math.cos(phi) * 1.35; // front-back (long axis)
    const y = r * Math.cos(theta) * 0.92; // up
    let z = r * Math.sin(theta) * Math.sin(phi) * 1.02; // depth / hemispheres
    const gap = 0.055;
    z += Math.sign(z || 1) * gap; // open the central fissure
    if (Math.abs(z) < gap * 1.15 && y > 0.15) continue; // groove
    push(x, y, z);
  }

  // Cerebellum — tighter folds, lower and toward the back.
  const CEREBELLUM = 240;
  for (let i = 0; i < CEREBELLUM; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = Math.acos(2 * u - 1);
    const phi = 2 * Math.PI * v;
    let r = 1 + 0.07 * Math.sin(10 * phi) * Math.sin(9 * theta);
    r *= 0.9 + Math.random() * 0.05;
    const cx = -0.98;
    const cy = -0.58;
    const R = 0.42;
    push(
      cx + r * Math.sin(theta) * Math.cos(phi) * R * 1.15,
      cy + r * Math.cos(theta) * R * 0.8,
      r * Math.sin(theta) * Math.sin(phi) * R
    );
  }

  // Brain stem.
  const STEM = 70;
  for (let i = 0; i < STEM; i++) {
    const t = i / STEM;
    push(
      -0.72 + t * 0.14 + (Math.random() - 0.5) * 0.06,
      -0.72 - t * 0.52,
      (Math.random() - 0.5) * 0.12
    );
  }

  // Circuit lines — connect a subset of points to their nearest neighbor.
  const lines: number[] = [];
  for (let i = 0; i < all.length; i += 3) {
    const a = all[i];
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < all.length; j += 2) {
      if (j === i) continue;
      const b = all[j];
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < bd && d > 0.0002) {
        bd = d;
        best = j;
      }
    }
    if (best >= 0 && bd < 0.11) {
      const b = all[best];
      lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }

  // Pulsing neurons.
  const neurons: { pos: [number, number, number]; phase: number }[] = [];
  for (let k = 0; k < 30; k++) {
    const p = all[Math.floor(Math.random() * all.length)];
    neurons.push({ pos: [p[0], p[1], p[2]], phase: Math.random() * Math.PI * 2 });
  }

  return {
    positions: new Float32Array(positions),
    lines: new Float32Array(lines),
    neurons,
  };
}

/** Soft round glow sprite for the point cloud. */
function useGlowTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(190,245,255,0.85)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

export function NeuralBrain() {
  const sprite = useGlowTexture();
  const { positions, lines, neurons } = useMemo(buildBrain, []);

  // Instanced pulsing neurons.
  const instRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (instRef.current) {
      neurons.forEach((n, i) => {
        const s = 0.028 + (Math.sin(t * 2.4 + n.phase) * 0.5 + 0.5) * 0.055;
        dummy.position.set(n.pos[0], n.pos[1], n.pos[2]);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        instRef.current!.setMatrixAt(i, dummy.matrix);
      });
      instRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Point cloud */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={sprite}
          size={0.055}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#5ee7f5"
          opacity={0.9}
          toneMapped={false}
        />
      </points>

      {/* Circuit lines */}
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color="#22d3ee"
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {/* Pulsing neurons */}
      <instancedMesh ref={instRef} args={[undefined, undefined, neurons.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial
          color="#c8fbff"
          transparent
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}
