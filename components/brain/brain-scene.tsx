"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { NeuralBrain } from "./neural-brain";
import { CategoryNode } from "./category-node";
import { NoteGraph, type GraphEdge, type GraphNode } from "./note-graph";
import { ThoughtTraceLayer } from "./thought-trace";
import type { ThoughtTrace } from "@/lib/brain/context";
import type { Vec3 } from "@/lib/brain/layout";
import { categories, type BrainCategoryId } from "@/lib/data/brain";

export function BrainScene({
  selectedRegion,
  onSelectRegion,
  labels,
  nodes,
  edges,
  selectedNoteId,
  onSelectNote,
  trace,
  positions,
}: {
  selectedRegion: BrainCategoryId | null;
  onSelectRegion: (id: BrainCategoryId) => void;
  labels: Record<BrainCategoryId, string>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  /** How the brain read the last question, to draw; keyed by replay. */
  trace: { data: ThoughtTrace; run: number } | null;
  positions: ReadonlyMap<string, Vec3>;
}) {
  return (
    <Canvas camera={{ position: [0, 0.4, 4.7], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      {/* Brain, regions and notes share one oriented group so everything stays
          on the surface it belongs to. */}
      <group rotation={[0.12, -0.5, 0]}>
        <NeuralBrain quiet={!!trace} />
        {categories.map((c) => (
          <CategoryNode
            key={c.id}
            category={c}
            label={labels[c.id]}
            selected={selectedRegion === c.id}
            onSelect={onSelectRegion}
          />
        ))}
        <NoteGraph nodes={nodes} edges={edges} selectedId={selectedNoteId} onSelect={onSelectNote} />
        {trace && <ThoughtTraceLayer key={trace.run} trace={trace.data} positions={positions} />}
      </group>

      <OrbitControls
        // Stop spinning once someone is looking at a note or following a
        // trace, or it drifts away from under them.
        autoRotate={!selectedNoteId && !trace}
        autoRotateSpeed={0.5}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={3.2}
        maxDistance={7}
        minPolarAngle={Math.PI * 0.15}
        maxPolarAngle={Math.PI * 0.85}
      />
    </Canvas>
  );
}
