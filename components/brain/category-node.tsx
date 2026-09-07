"use client";

import * as THREE from "three";
import { useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { BrainCategory, BrainCategoryId } from "@/lib/data/brain";

export function CategoryNode({
  category,
  label,
  selected,
  onSelect,
}: {
  category: BrainCategory;
  label: string;
  selected: boolean;
  onSelect: (id: BrainCategoryId) => void;
}) {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const active = hover || selected;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = Math.sin(t * 2.2 + category.phase) * 0.5 + 0.5;
    const base = active ? 1.5 : 1;
    if (core.current) core.current.scale.setScalar(base * (0.9 + pulse * 0.25));
    if (halo.current) {
      const h = base * (2.6 + pulse * 0.9);
      halo.current.scale.setScalar(h);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = active ? 0.28 : 0.16;
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    setHover(false);
    document.body.style.cursor = "";
  };

  return (
    <group position={category.anchor}>
      {/* Hit target (invisible but raycastable) */}
      <mesh
        onPointerOver={over}
        onPointerOut={out}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(category.id);
        }}
      >
        <sphereGeometry args={[0.17, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Glow halo */}
      <mesh ref={halo} scale={2.6}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial color={category.color} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* Core */}
      <mesh ref={core}>
        <sphereGeometry args={[0.05, 20, 20]} />
        <meshBasicMaterial color={category.color} toneMapped={false} />
      </mesh>

      {/* Selection ring */}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.13, 0.15, 32]} />
          <meshBasicMaterial color={category.color} transparent opacity={0.7} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}

      {active && (
        <Html center distanceFactor={9} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
          <div
            className="flex -translate-y-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur"
            style={{
              borderColor: `${category.color}55`,
              background: "rgba(10,12,18,0.75)",
              color: "#e8eef2",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: category.color }} />
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
