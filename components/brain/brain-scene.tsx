"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { NeuralBrain } from "./neural-brain";
import { CategoryNode } from "./category-node";
import { categories, type BrainCategoryId } from "@/lib/data/brain";

export function BrainScene({
  selected,
  onSelect,
  labels,
}: {
  selected: BrainCategoryId | null;
  onSelect: (id: BrainCategoryId) => void;
  labels: Record<BrainCategoryId, string>;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.4, 4.7], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      {/* Brain + markers share one oriented group so anchors stay on the surface. */}
      <group rotation={[0.12, -0.5, 0]}>
        <NeuralBrain />
        {categories.map((c) => (
          <CategoryNode key={c.id} category={c} label={labels[c.id]} selected={selected === c.id} onSelect={onSelect} />
        ))}
      </group>

      <OrbitControls
        autoRotate
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
