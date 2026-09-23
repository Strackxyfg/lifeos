"use client";

import * as THREE from "three";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { Vec3 } from "@/lib/brain/layout";
import { RELATION_COLOR } from "@/lib/brain/relations";
import type { ThoughtTrace } from "@/lib/brain/context";

/**
 * How the brain read a question, drawn in the brain itself.
 *
 * The question enters at the centre; an impulse travels to each note that
 * matched it, which lights up; from there, impulses run along the connections
 * that were followed, in the colour of each connection, and light the notes
 * they reach. Goals and focus notes glow faintly throughout: they are always
 * in the context. What is drawn is exactly what the model was given — the
 * trace comes from the grounding itself, not from the answer's text.
 *
 * With reduced motion requested, the end state is shown at once.
 */

const ORIGIN: Vec3 = [0, 0.05, 0];
const SEED = new THREE.Color("#67e8f9");
const CONTEXT = new THREE.Color("#94a3b8");
/** Seconds: centre to a matched note, the gap between two, along a connection. */
const TRAVEL = 0.65;
const STAGGER = 0.16;
const HOP = 0.6;
/** Particles per impulse: a head and a fading tail. */
const TAIL = 5;

interface Impulse {
  from: Vec3;
  to: Vec3;
  start: number;
  dur: number;
  color: THREE.Color;
}
interface Glow {
  at: Vec3;
  start: number;
  size: number;
  color: THREE.Color;
  /** A steady glow, without the flash of a note being reached. */
  quiet: boolean;
}

export function planTrace(trace: ThoughtTrace, positions: ReadonlyMap<string, Vec3>) {
  const impulses: Impulse[] = [];
  const glows: Glow[] = [];
  const lit = new Map<string, number>();

  trace.seeds.forEach((s, i) => {
    const p = positions.get(s.id);
    if (!p) return;
    const start = i * STAGGER;
    impulses.push({ from: ORIGIN, to: p, start, dur: TRAVEL, color: SEED });
    lit.set(s.id, start + TRAVEL);
    glows.push({ at: p, start: start + TRAVEL, size: 1, color: SEED, quiet: false });
  });
  trace.hops.forEach((h, j) => {
    const a = positions.get(h.from);
    const b = positions.get(h.to);
    const reached = lit.get(h.from);
    if (!a || !b || reached === undefined) return;
    const color = new THREE.Color(RELATION_COLOR[h.kind]);
    const start = reached + 0.12 + (j % 4) * 0.07;
    impulses.push({ from: a, to: b, start, dur: HOP, color });
    if (!lit.has(h.to)) {
      lit.set(h.to, start + HOP);
      glows.push({ at: b, start: start + HOP, size: 0.78, color, quiet: false });
    }
  });
  for (const id of trace.context) {
    const p = positions.get(id);
    if (!p || lit.has(id)) continue;
    glows.push({ at: p, start: 0, size: 0.55, color: CONTEXT, quiet: true });
  }
  return { impulses, glows };
}

const ease = (x: number) => 1 - (1 - x) ** 3;
const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function ThoughtTraceLayer({ trace, positions }: { trace: ThoughtTrace; positions: ReadonlyMap<string, Vec3> }) {
  const { impulses, glows } = useMemo(() => planTrace(trace, positions), [trace, positions]);
  const reduced = useReducedMotion();
  const particles = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const began = useRef<number | null>(null);

  // Colours once per trace; the tail of an impulse is dimmer, which under
  // additive blending reads as fading out.
  useLayoutEffect(() => {
    const pm = particles.current;
    if (pm) {
      impulses.forEach((imp, i) => {
        for (let k = 0; k < TAIL; k++) pm.setColorAt(i * TAIL + k, tmpColor.copy(imp.color).multiplyScalar(1 - k / TAIL));
      });
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    }
    const hm = halos.current;
    if (hm) {
      glows.forEach((g, i) => hm.setColorAt(i, tmpColor.copy(g.color).multiplyScalar(g.quiet ? 0.4 : 1)));
      if (hm.instanceColor) hm.instanceColor.needsUpdate = true;
    }
  }, [impulses, glows]);

  // A new trace starts from the beginning; the same trace redrawn (notes
  // moving, colours changing) carries on where it was.
  useLayoutEffect(() => {
    began.current = null;
  }, [trace]);

  useFrame(({ clock }) => {
    if (began.current === null) began.current = clock.elapsedTime;
    const t = reduced ? Number.POSITIVE_INFINITY : clock.elapsedTime - began.current;

    const pm = particles.current;
    if (pm) {
      impulses.forEach((imp, i) => {
        for (let k = 0; k < TAIL; k++) {
          const p = (t - imp.start) / imp.dur - k * 0.06;
          const on = p > 0 && p < 1;
          const e = ease(Math.min(1, Math.max(0, p)));
          tmp.position.set(
            imp.from[0] + (imp.to[0] - imp.from[0]) * e,
            imp.from[1] + (imp.to[1] - imp.from[1]) * e,
            imp.from[2] + (imp.to[2] - imp.from[2]) * e
          );
          tmp.scale.setScalar(on ? 1 - k * 0.16 : 0);
          tmp.updateMatrix();
          pm.setMatrixAt(i * TAIL + k, tmp.matrix);
        }
      });
      pm.instanceMatrix.needsUpdate = true;
    }

    const hm = halos.current;
    if (hm) {
      const now = reduced ? 0 : clock.elapsedTime;
      glows.forEach((g, i) => {
        const k = t - g.start;
        let s = 0;
        if (k >= 0) {
          const grow = Math.min(1, k / 0.1);
          // A flash when the impulse arrives, then a slow breath.
          const flash = !g.quiet && k < 0.4 ? 1 + 1.4 * (1 - k / 0.4) : 1 + 0.1 * Math.sin(now * 2.2 + i);
          s = g.size * grow * flash;
        }
        tmp.position.set(...g.at);
        tmp.scale.setScalar(s);
        tmp.updateMatrix();
        hm.setMatrixAt(i, tmp.matrix);
      });
      hm.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {impulses.length > 0 && (
        <instancedMesh
          key={`p${impulses.length}`}
          ref={particles}
          args={[undefined, undefined, impulses.length * TAIL]}
          frustumCulled={false}
          raycast={() => null}
        >
          <sphereGeometry args={[0.021, 10, 10]} />
          <meshBasicMaterial toneMapped={false} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
        </instancedMesh>
      )}
      {glows.length > 0 && (
        <instancedMesh
          key={`h${glows.length}`}
          ref={halos}
          args={[undefined, undefined, glows.length]}
          frustumCulled={false}
          raycast={() => null}
        >
          <sphereGeometry args={[0.075, 18, 18]} />
          <meshBasicMaterial toneMapped={false} transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
        </instancedMesh>
      )}
    </group>
  );
}
