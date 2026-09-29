"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { DistrictId } from "@/lib/hub/districts";
import { DIMENSIONS, INTERIORS, type Item } from "@/lib/hub/interiors";
import { seeded } from "@/lib/hub/island";
import { INDOOR_SKY, lightScale } from "./materials";
import { useHubLight } from "./light";

/**
 * The furniture of a building, built from `lib/hub/interiors.ts`: every
 * table, chair, shelf of books, screen and lamp merged into two meshes —
 * one lit like any surface (vertex-coloured), one that glows (screens,
 * bulbs, LEDs, ceiling panels). Two draw calls a building, however many
 * chairs.
 */

type V3 = [number, number, number];

interface Part {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  glow: boolean;
}

const DARK = "#2a2d33";
const METAL = "#6b7078";
const TERRACOTTA = "#a4623f";
const LEAF = ["#3f6b34", "#4d7a3a", "#355d2e"];
const BOOKS = ["#7b2e2e", "#2e4a7b", "#c9a45a", "#2f5d4a", "#8a8f96", "#d8d2c4", "#5b3a6b", "#b5542f", "#1f2a3a"];

class Kit {
  parts: Part[] = [];

  box(size: V3, at: V3, color: string | THREE.Color, glow = false) {
    const g = new THREE.BoxGeometry(...size);
    g.translate(...at);
    this.parts.push({ geometry: g, color: new THREE.Color(color), glow });
  }

  cyl(rt: number, rb: number, h: number, at: V3, color: string | THREE.Color, seg = 12, glow = false) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(...at);
    this.parts.push({ geometry: g, color: new THREE.Color(color), glow });
  }

  sphere(r: number, at: V3, color: string | THREE.Color, scale: V3 = [1, 1, 1], glow = false) {
    const g = new THREE.SphereGeometry(r, 10, 8);
    g.scale(...scale);
    g.translate(...at);
    this.parts.push({ geometry: g, color: new THREE.Color(color), glow });
  }

  cone(r: number, h: number, at: V3, color: string | THREE.Color, open = false) {
    const g = new THREE.CylinderGeometry(r * 0.35, r, h, 14, 1, open);
    g.translate(...at);
    this.parts.push({ geometry: g, color: new THREE.Color(color), glow: false });
  }
}

/** Builds one item, in its own frame: origin on the floor (or its hanging point), facing +Z. */
function build(kit: Kit, item: Item, lightHex: string) {
  const dim = DIMENSIONS[item.kind];
  const [w, d] = item.size ?? [dim.w, dim.d];
  const h = dim.h;
  const c = item.color;
  // Bulbs glow in the building's own light, hot enough to bloom.
  const bulb = new THREE.Color(lightHex).multiplyScalar(5);
  const rnd = seeded(Math.round((item.at[0] * 131 + item.at[2] * 71 + item.at[1] * 17) * 1000) || 1);

  switch (item.kind) {
    case "table": {
      kit.box([w, 0.012, d], [0, h - 0.006, 0], c ?? "#b98b5e");
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box([0.012, h - 0.012, 0.012], [sx * (w / 2 - 0.02), (h - 0.012) / 2, sz * (d / 2 - 0.02)], DARK);
      break;
    }
    case "roundTable": {
      kit.cyl(w / 2, w / 2, 0.01, [0, h - 0.005, 0], c ?? "#d9d4ca", 20);
      kit.cyl(0.008, 0.008, h - 0.01, [0, (h - 0.01) / 2, 0], DARK, 6);
      kit.cyl(0.045, 0.05, 0.008, [0, 0.004, 0], DARK, 14);
      break;
    }
    case "chair": {
      const col = c ?? DARK;
      kit.box([0.1, 0.012, 0.1], [0, 0.115, 0], col);
      kit.box([0.1, 0.1, 0.012], [0, 0.17, -0.044], col);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box([0.008, 0.11, 0.008], [sx * 0.042, 0.055, sz * 0.042], DARK);
      break;
    }
    case "stool": {
      kit.cyl(0.038, 0.038, 0.012, [0, 0.18, 0], c ?? "#9a6f4c", 12);
      kit.cyl(0.006, 0.006, 0.17, [0, 0.087, 0], METAL, 6);
      kit.cyl(0.032, 0.035, 0.006, [0, 0.003, 0], METAL, 12);
      break;
    }
    case "desk": {
      const top = c ?? "#e9e6df";
      kit.box([w, 0.012, d], [0, h - 0.006, 0], top);
      for (const sx of [-1, 1]) kit.box([0.01, h - 0.012, d - 0.02], [sx * (w / 2 - 0.01), (h - 0.012) / 2, 0], DARK);
      // A screen at the far edge, facing the chair (−Z), and a keyboard.
      kit.box([0.012, 0.05, 0.012], [0, h + 0.025, d / 2 - 0.04], DARK);
      kit.box([0.14, 0.085, 0.008], [0, h + 0.085, d / 2 - 0.04], DARK);
      kit.box([0.126, 0.072, 0.002], [0, h + 0.085, d / 2 - 0.049], "#8fb8ff", true);
      kit.box([0.1, 0.004, 0.035], [0, h + 0.002, -0.01], "#cfd2d6");
      break;
    }
    case "sofa":
    case "armchair": {
      const col = c ?? "#6c7280";
      kit.box([w, 0.06, d], [0, 0.05, 0], col);
      kit.box([w - 0.06, 0.03, d - 0.06], [0, 0.095, 0.015], new THREE.Color(col).multiplyScalar(1.12));
      kit.box([w, 0.1, 0.05], [0, 0.13, -d / 2 + 0.025], col);
      for (const sx of [-1, 1]) kit.box([0.035, 0.08, d], [sx * (w / 2 - 0.0175), 0.1, 0], col);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box([0.012, 0.02, 0.012], [sx * (w / 2 - 0.02), 0.01, sz * (d / 2 - 0.02)], DARK);
      break;
    }
    case "counter": {
      kit.box([w, h - 0.02, d], [0, (h - 0.02) / 2, 0], c ?? "#5e3f2b");
      kit.box([w + 0.02, 0.02, d + 0.02], [0, h - 0.01, 0], "#d8d4cc");
      break;
    }
    case "shelf": {
      const wood = c ?? "#5e3f2b";
      for (const sx of [-1, 1]) kit.box([0.012, h, d], [sx * (w / 2 - 0.006), h / 2, 0], wood);
      kit.box([w, h, 0.006], [0, h / 2, -d / 2 + 0.003], new THREE.Color(wood).multiplyScalar(0.8));
      const levels = [0.01, 0.13, 0.25, 0.37, 0.49];
      for (const y of levels) kit.box([w - 0.02, 0.01, d], [0, y, 0], wood);
      // Books on the lower four shelves: leaning a little, never all the same.
      for (let l = 0; l < 4; l++) {
        let x = -w / 2 + 0.018;
        const base = levels[l] + 0.005;
        while (x < w / 2 - 0.04) {
          const bw = 0.012 + rnd() * 0.014;
          const bh = 0.065 + rnd() * 0.035;
          if (rnd() > 0.1) kit.box([bw, bh, d * 0.75], [x + bw / 2, base + bh / 2, 0.004], BOOKS[Math.floor(rnd() * BOOKS.length)]);
          x += bw + 0.002;
        }
      }
      break;
    }
    case "plant": {
      kit.cyl(0.045, 0.035, 0.07, [0, 0.035, 0], rnd() > 0.5 ? TERRACOTTA : "#e4e0d7", 12);
      kit.sphere(0.07, [0, 0.14, 0], LEAF[0], [1, 1.2, 1]);
      kit.sphere(0.055, [0.03, 0.22, 0.02], LEAF[1], [1, 1.3, 1]);
      kit.sphere(0.045, [-0.03, 0.27, -0.02], LEAF[2], [1, 1.2, 1]);
      break;
    }
    case "pendant": {
      kit.cyl(0.002, 0.002, 0.4, [0, 0.24, 0], DARK, 4);
      kit.cone(0.05, 0.05, [0, 0.03, 0], c ?? "#1f2227", true);
      kit.sphere(0.018, [0, 0.005, 0], bulb, [1, 1, 1], true);
      break;
    }
    case "floorLamp": {
      kit.cyl(0.035, 0.035, 0.008, [0, 0.004, 0], DARK, 12);
      kit.cyl(0.004, 0.004, 0.34, [0, 0.17, 0], DARK, 6);
      kit.cone(0.045, 0.06, [0, 0.36, 0], "#efe6d4", true);
      kit.sphere(0.016, [0, 0.35, 0], bulb, [1, 1, 1], true);
      break;
    }
    case "rack": {
      kit.box([w, h, d], [0, h / 2, 0], c ?? "#1d2127");
      // A column of blinking-looking LEDs on the front: green, a few blue, one amber.
      for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 3; col++) {
          const r = rnd();
          const led = r > 0.93 ? "#ffb020" : r > 0.7 ? "#3aa0ff" : "#34e27a";
          if (r < 0.2) continue;
          kit.box([0.012, 0.006, 0.002], [-0.04 + col * 0.04, 0.05 + row * 0.036, d / 2 + 0.001], new THREE.Color(led).multiplyScalar(2.2), true);
        }
      }
      break;
    }
    case "board": {
      kit.box([w, h, 0.01], [0, 0, 0], "#c9c6bf");
      kit.box([w - 0.02, h - 0.02, 0.004], [0, 0, 0.006], c ?? "#f4f4f1");
      // A few marker strokes.
      for (let i = 0; i < 5; i++) kit.box([w * (0.2 + rnd() * 0.4), 0.006, 0.002], [-w * 0.2 + rnd() * w * 0.2, h * 0.3 - i * h * 0.13, 0.009], i % 2 ? "#2e4a7b" : "#b5542f");
      break;
    }
    case "screen": {
      kit.box([w, h, 0.012], [0, 0, 0], DARK);
      // A dashboard: a dim ground and brighter tiles.
      kit.box([w - 0.02, h - 0.02, 0.002], [0, 0, 0.007], new THREE.Color("#1b3a6b").multiplyScalar(1.4), true);
      for (let i = 0; i < 6; i++) {
        const tx = -w / 2 + 0.05 + (i % 3) * ((w - 0.1) / 3) + (w - 0.1) / 6;
        const ty = i < 3 ? h * 0.2 : -h * 0.15;
        kit.box([(w - 0.14) / 3, h * 0.28, 0.002], [tx, ty, 0.009], new THREE.Color(i === 1 ? "#7de8b0" : "#8fb8ff").multiplyScalar(1.6), true);
      }
      break;
    }
    case "rug": {
      kit.box([w, 0.004, d], [0, 0.002, 0], c ?? "#6d5a8c");
      break;
    }
    case "bench": {
      kit.box([w, 0.02, d], [0, 0.11, 0], c ?? "#5e3f2b");
      for (const sx of [-1, 1]) kit.box([0.02, 0.1, d - 0.02], [sx * (w / 2 - 0.04), 0.05, 0], DARK);
      break;
    }
    case "machine": {
      kit.box([w, h * 0.7, d], [0, (h * 0.7) / 2, 0], c ?? "#b9bcc0");
      kit.box([w * 0.8, h * 0.3, d * 0.6], [0, h * 0.85, -d * 0.1], DARK);
      kit.box([0.02, 0.012, 0.002], [w * 0.3, h * 0.5, d / 2 + 0.001], new THREE.Color("#34e27a").multiplyScalar(2), true);
      break;
    }
    case "model": {
      kit.box([w, 0.01, d], [0, 0.005, 0], "#f4f2ee");
      for (let i = 0; i < 9; i++) {
        const bw = 0.04 + rnd() * 0.05;
        const bh = 0.03 + rnd() * 0.17;
        kit.box([bw, bh, bw], [(rnd() - 0.5) * (w - 0.1), 0.01 + bh / 2, (rnd() - 0.5) * (d - 0.1)], "#f7f5f1");
      }
      break;
    }
    case "panel": {
      kit.box([w, 0.006, d], [0, -0.003, 0], new THREE.Color("#f3f6ff").multiplyScalar(1.8), true);
      break;
    }
  }
}

function withColor(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Merged furniture geometry of a building: what is lit, and what glows. */
export function furnitureGeometry(id: DistrictId): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const interior = INTERIORS[id];
  if (!interior) return { solid: null, glow: null };
  const solid: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (const room of interior.rooms) {
    for (const item of room.items) {
      const kit = new Kit();
      build(kit, item, interior.light);
      m.makeRotationY(item.rot ?? 0).setPosition(...item.at);
      for (const p of kit.parts) {
        p.geometry.applyMatrix4(m);
        (p.glow ? glow : solid).push(withColor(p.geometry, p.color));
      }
    }
  }
  const merge = (list: THREE.BufferGeometry[]) => {
    if (!list.length) return null;
    const g = mergeGeometries(list, false);
    for (const x of list) x.dispose();
    return g;
  };
  return { solid: merge(solid), glow: merge(glow) };
}

let solidMaterial: THREE.MeshStandardMaterial | null = null;
let glowMaterial: THREE.MeshBasicMaterial | null = null;

/** Furniture is indoors: the sky reaches it only through the windows, so it takes less of it. */
function materials() {
  solidMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: INDOOR_SKY * 1.2 });
  glowMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true });
  return { solid: solidMaterial, glow: glowMaterial };
}

export function Furniture({ id }: { id: DistrictId }) {
  const light = useHubLight();
  const geo = useMemo(() => furnitureGeometry(id), [id]);
  const mats = materials();
  useEffect(
    () => () => {
      geo.solid?.dispose();
      geo.glow?.dispose();
    },
    [geo]
  );
  const seen = useRef(-1);
  // Shared: whichever building runs first each light change sets it for all.
  useFrame(() => {
    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    // Screens and bulbs are on all day, brighter-looking at night.
    mats.glow.color.setScalar((0.55 + 0.45 * l.sky.lamps) * lightScale(l.atmo.exposure));
  });
  return (
    <>
      {geo.solid && <mesh geometry={geo.solid} material={mats.solid} receiveShadow />}
      {/* The ray-traced photo turns these into emitters in the building's light. */}
      {geo.glow && <mesh geometry={geo.glow} material={mats.glow} userData={{ traceEmissive: INTERIORS[id]?.light }} />}
    </>
  );
}

/**
 * The building's own lamps: real point lights in its colour, lighting its
 * rooms and, at night, spilling through the windows onto the paving.
 * All of them on capable devices, one per building otherwise, none on the
 * lowest tier (the glowing fixtures still show).
 */
export function InteriorLights({ id, count }: { id: DistrictId; count: number }) {
  const interior = INTERIORS[id];
  const light = useHubLight();
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  const seen = useRef(-1);
  const color = useMemo(() => new THREE.Color(interior?.light ?? "#ffffff"), [interior]);
  useFrame(() => {
    const l = light.current;
    if (l.version === seen.current) return;
    seen.current = l.version;
    // On all day, as shops' are — but by day a lamp is nothing next to the
    // sun coming through the windows, and the rooms read dark behind the
    // glass's reflection, as real ones do. At night they are the light.
    // Fewer lamps (a weaker device) light the room as much between them.
    const lamps = interior?.lamps.length ?? 1;
    const i = (7.5 * (interior?.power ?? 1) * (0.12 + 0.88 * l.sky.lamps) * lightScale(l.atmo.exposure) * lamps) / Math.max(1, Math.min(count, lamps));
    for (const p of refs.current) if (p) p.intensity = i;
  });
  useEffect(() => {
    seen.current = -1;
  }, [count]);
  if (!interior || count <= 0) return null;
  return (
    <>
      {interior.lamps.slice(0, count).map((at, k) => (
        <pointLight
          key={k}
          ref={(p) => void (refs.current[k] = p)}
          position={at}
          color={color}
          intensity={0}
          distance={4.2}
          decay={2}
        />
      ))}
    </>
  );
}
