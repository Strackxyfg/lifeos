"use client";

import * as THREE from "three";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Vec3 } from "@/lib/brain/layout";

/**
 * The notes themselves, as neurons, and the links between them, as synapses.
 *
 * Until this existed the 3D brain was decoration: five fixed markers, the same
 * for every user, no matter what they had written. Now the scene *is* the
 * brain — each point a note you wrote, each line a connection you made.
 *
 * Nodes are one instanced mesh — a single draw call for every note, which is
 * what keeps a few hundred of them smooth on a laptop.
 */

/**
 * A synapse as drawn: its colour says what kind of connection it is, and a
 * dashed line says it was drawn by LifeOS or the agent and awaits review.
 */
export interface GraphEdge {
  from: Vec3;
  to: Vec3;
  /** Touches the selected note. */
  active: boolean;
  color: string;
  pending: boolean;
}

export interface GraphNode {
  id: string;
  title: string;
  position: Vec3;
  color: string;
  done: boolean;
  /** De-emphasised because another region is selected. */
  dim: boolean;
}

const RADIUS = 0.03;
const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

export function NoteGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // Instance capacity is fixed when the mesh is created. Reserve it in blocks
  // of 64 so adding a note doesn't rebuild the mesh every time; `count` below
  // limits drawing and hit-testing to the notes that actually exist.
  const capacity = Math.max(64, Math.ceil(nodes.length / 64) * 64);

  // Positions and colours are written once per data change, not per frame.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    nodes.forEach((n, i) => {
      tmp.position.set(...n.position);
      const s = n.id === selectedId ? 1.9 : n.done ? 0.65 : 1;
      tmp.scale.setScalar(s);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);

      tmpColor.set(n.color);
      // Finished and out-of-focus notes recede instead of disappearing, so the
      // shape of the brain stays readable.
      if (n.done || n.dim) tmpColor.multiplyScalar(n.dim ? 0.28 : 0.45);
      m.setColorAt(i, tmpColor);
    });
    m.count = nodes.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [nodes, selectedId]);

  // Only the selected note breathes, to say "this one" without a label.
  const selectedIndex = useMemo(() => nodes.findIndex((n) => n.id === selectedId), [nodes, selectedId]);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m || selectedIndex < 0) return;
    const n = nodes[selectedIndex];
    tmp.position.set(...n.position);
    tmp.scale.setScalar(1.9 + Math.sin(clock.elapsedTime * 3) * 0.25);
    tmp.updateMatrix();
    m.setMatrixAt(selectedIndex, tmp.matrix);
    m.instanceMatrix.needsUpdate = true;
  });

  // Three batches — settled, touching the selection, awaiting review — each a
  // single draw call, with a colour per vertex so every line keeps its kind.
  const generation = useRef(0);
  const batches = useMemo(() => {
    // Every rebuild gets a fresh geometry (see the keys below).
    generation.current += 1;
    const make = () => ({ pos: [] as number[], col: [] as number[] });
    const groups = { base: make(), active: make(), pending: make() };
    const c = new THREE.Color();
    for (const e of edges) {
      const g = e.active ? groups.active : e.pending ? groups.pending : groups.base;
      g.pos.push(...e.from, ...e.to);
      c.set(e.color);
      g.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const out = (g: { pos: number[]; col: number[] }) => ({ pos: new Float32Array(g.pos), col: new Float32Array(g.col) });
    return {
      id: generation.current,
      base: out(groups.base),
      active: out(groups.active),
      pending: out(groups.pending),
    };
  }, [edges]);

  // Dashes are measured along each segment; the distances must be computed
  // whenever the geometry is rebuilt.
  const dashed = useRef<THREE.LineSegments>(null);
  useLayoutEffect(() => {
    dashed.current?.computeLineDistances();
  }, [batches.pending]);

  useEffect(() => () => void (document.body.style.cursor = ""), []);

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;
    setHovered(e.instanceId);
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    setHovered(null);
    document.body.style.cursor = "";
  };

  const label = hovered !== null ? nodes[hovered] : selectedIndex >= 0 ? nodes[selectedIndex] : null;

  return (
    <group>
      {/* Keyed by rebuild: a buffer that changes needs a fresh geometry, or
          the old draw range lingers and paints phantom lines. */}
      {batches.base.pos.length > 0 && (
        <lineSegments key={`b${batches.id}`} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[batches.base.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[batches.base.col, 3]} />
          </bufferGeometry>
          <lineBasicMaterial vertexColors transparent opacity={0.45} depthWrite={false} toneMapped={false} />
        </lineSegments>
      )}
      {batches.pending.pos.length > 0 && (
        <lineSegments
          ref={dashed}
          key={`p${batches.id}`}
          frustumCulled={false}
        >
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[batches.pending.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[batches.pending.col, 3]} />
          </bufferGeometry>
          <lineDashedMaterial
            vertexColors
            dashSize={0.035}
            gapSize={0.03}
            transparent
            opacity={0.6}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      )}
      {batches.active.pos.length > 0 && (
        <lineSegments key={`a${batches.id}`} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[batches.active.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[batches.active.col, 3]} />
          </bufferGeometry>
          <lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} toneMapped={false} />
        </lineSegments>
      )}

      <instancedMesh
        key={capacity}
        ref={mesh}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        onPointerMove={over}
        onPointerOut={out}
        onClick={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onSelect(nodes[e.instanceId].id);
        }}
      >
        <sphereGeometry args={[RADIUS, 14, 14]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {label && (
        // Smaller than the region labels: a note's title is longer, and at the
        // region scale it covered half the brain.
        <Html position={label.position} center distanceFactor={5.5} zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
          <div
            className="max-w-[190px] -translate-y-5 truncate whitespace-nowrap rounded-md border px-2 py-0.5 text-[10px] font-medium backdrop-blur"
            style={{ borderColor: `${label.color}55`, background: "rgba(10,12,18,0.82)", color: "#e8eef2" }}
          >
            {label.title}
          </div>
        </Html>
      )}
    </group>
  );
}
