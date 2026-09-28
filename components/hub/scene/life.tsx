"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DOCK, FOUNTAIN, PATHS, seeded, type Point } from "@/lib/hub/island";
import { glowTexture, hubMaterials } from "./materials";
import { useHubLight } from "./light";
import { WATER_LEVEL } from "./water";

/* ── People ──────────────────────────────────────────────────────── */

type Route = { kind: "loop"; center: Point; radius: number } | { kind: "line"; from: Point; to: Point };

const ROUTES: Route[] = [
  { kind: "loop", center: FOUNTAIN.center, radius: 3.45 },
  { kind: "loop", center: FOUNTAIN.center, radius: 4.45 },
  ...PATHS.map((p): Route => ({ kind: "line", from: p.from, to: p.to })),
  { kind: "line", from: DOCK.from, to: [DOCK.to[0], DOCK.to[1] - 0.8] },
];

function routeLength(r: Route): number {
  return r.kind === "loop" ? 2 * Math.PI * r.radius : Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
}

/** Where someone `s` units along a route is, and which way they face. */
function along(r: Route, s: number, lane: number): { x: number; z: number; heading: number } {
  if (r.kind === "loop") {
    const a = s / r.radius;
    const rr = r.radius + lane;
    return { x: r.center[0] + Math.cos(a) * rr, z: r.center[1] + Math.sin(a) * rr, heading: -a };
  }
  // There and back: a ping-pong along the segment.
  const len = routeLength(r);
  const u = ((s % (2 * len)) + 2 * len) % (2 * len);
  const back = u > len;
  const t = back ? 2 - u / len : u / len;
  const dx = r.to[0] - r.from[0];
  const dz = r.to[1] - r.from[1];
  // Keep to the right-hand side of the path, like people do.
  const nx = (-dz / len) * lane * (back ? -1 : 1);
  const nz = (dx / len) * lane * (back ? -1 : 1);
  const heading = Math.atan2(dx, dz) + (back ? Math.PI : 0);
  return { x: r.from[0] + dx * t + nx, z: r.from[1] + dz * t + nz, heading };
}

const CLOTHES = ["#2f4a7a", "#c8553d", "#f2f2ee", "#2d2d33", "#7b9e87", "#d9a441", "#5b6d91", "#a14d6b", "#e8d9c4", "#3f7f93"];
const SKIN = ["#f1c7a5", "#d9a47c", "#a9714b", "#7a4b2f", "#e8b893"];

interface Walker {
  route: number;
  offset: number;
  speed: number;
  lane: number;
  /** Stays out after dark: the lower the rank, the later someone goes home. */
  rank: number;
}

/**
 * People on the plaza, on the paths and on the jetty — fewer after dark.
 * Two instanced meshes (bodies, heads), one matrix write each per frame.
 */
export function People({ count, reducedMotion }: { count: number; reducedMotion: boolean }) {
  const light = useHubLight();
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const walkers = useMemo<Walker[]>(() => {
    const rnd = seeded(1234);
    return Array.from({ length: count }, (_, i) => {
      const route = i < count * 0.45 ? (i % 2) : 2 + (i % (ROUTES.length - 2));
      const dir = rnd() < 0.5 ? -1 : 1;
      return {
        route,
        offset: rnd() * 60,
        speed: dir * (0.32 + rnd() * 0.22),
        lane: (rnd() - 0.5) * 0.35,
        rank: rnd(),
      };
    });
  }, [count]);

  const bodyGeometry = useMemo(() => {
    const g = new THREE.CapsuleGeometry(0.075, 0.2, 3, 8);
    g.translate(0, 0.18, 0);
    return g;
  }, []);
  const headGeometry = useMemo(() => {
    const g = new THREE.SphereGeometry(0.058, 10, 8);
    g.translate(0, 0.4, 0);
    return g;
  }, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.8 }), []);

  const colored = useRef(false);
  const o = useMemo(() => new THREE.Object3D(), []);
  const clock = useRef(0);

  useFrame((_, dt) => {
    const b = bodies.current;
    const h = heads.current;
    if (!b || !h) return;
    if (!colored.current) {
      const rnd = seeded(99);
      const c = new THREE.Color();
      walkers.forEach((_, i) => {
        b.setColorAt(i, c.set(CLOTHES[Math.floor(rnd() * CLOTHES.length)]));
        h.setColorAt(i, c.set(SKIN[Math.floor(rnd() * SKIN.length)]));
      });
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
      if (h.instanceColor) h.instanceColor.needsUpdate = true;
      colored.current = true;
    }
    clock.current += reducedMotion ? 0 : Math.min(dt, 0.1);
    const out = 1 - light.current.sky.lamps * 0.7;
    walkers.forEach((w, i) => {
      if (w.rank > out) {
        o.scale.setScalar(0);
      } else {
        const r = ROUTES[w.route];
        const s = w.offset + clock.current * w.speed;
        const p = along(r, s, w.lane);
        const step = Math.abs(Math.sin((s / 0.32) * Math.PI));
        o.position.set(p.x, step * 0.018, p.z);
        o.rotation.set(0, p.heading + (w.speed < 0 && r.kind === "loop" ? Math.PI : 0), 0);
        o.scale.setScalar(1);
      }
      o.updateMatrix();
      b.setMatrixAt(i, o.matrix);
      h.setMatrixAt(i, o.matrix);
    });
    b.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bodies} args={[bodyGeometry, material, count]} frustumCulled={false} />
      <instancedMesh ref={heads} args={[headGeometry, material, count]} frustumCulled={false} />
    </>
  );
}

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
        toneMapped: false,
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
