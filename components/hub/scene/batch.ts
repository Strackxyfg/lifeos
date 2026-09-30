import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LIFT_ATTRIBUTE } from "./lift";

/**
 * Draws a still subtree in as few draw calls as it has materials.
 *
 * A building is dozens of boxes, cylinders and rounded slabs sharing a
 * handful of materials; drawn one by one, each costs the page a draw call —
 * and in a browser a draw call is not cheap: its matrices and uniforms cross
 * to the GPU process one call at a time. Here the meshes that share a
 * material — and cast and receive shadows alike — are merged into one, in
 * the subtree's own frame (so a building still lifts as one when hovered).
 * A mesh made of several materials (a building's shell: outside, inside,
 * floor) is split by material first, each part joining its material's
 * batch. The picture is the same, triangle for triangle.
 *
 * The originals stay, hidden: pointer picking still hits their real shapes
 * (three's raycaster does not skip hidden objects), and nothing else sees
 * them (not the renderer, not the shadow map, not the photo's tracer).
 *
 * With `lift`, meshes of different buildings merge too — the whole island in
 * one draw per material — each vertex carrying its building's lift slot
 * (`userData.liftSlot` on the building's group, `lift.ts`), so a hovered
 * building still rises: in the shader, not as an object.
 *
 * Not merged: transparent surfaces (sorted one by one), instanced or skinned
 * meshes, and mirrored transforms (their winding would flip). A subtree
 * under `userData.dynamic` (moved every frame — a crane, a turning lens) is
 * merged apart, in its own frame, so it moves as before.
 *
 * Returns what undoes it.
 */
export function batchStatic(root: THREE.Object3D, opts: { lift?: boolean } = {}): () => void {
  root.updateWorldMatrix(true, true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { material: THREE.Material; parts: Part[] }>();
  const sources: THREE.Mesh[] = [];
  const nested: (() => void)[] = [];

  const walk = (o: THREE.Object3D, slot: number) => {
    if (o.userData.dynamic && o !== root) {
      nested.push(batchStatic(o));
      return;
    }
    if (typeof o.userData.liftSlot === "number") slot = o.userData.liftSlot;
    if (o !== root && o instanceof THREE.Mesh && batchable(o)) {
      const parts = split(o);
      if (parts && opts.lift) for (const p of parts) tagLift(p, slot);
      if (parts) {
        sources.push(o);
        for (const part of parts) {
          const g = part.geometry;
          const attrs = Object.keys(g.attributes)
            .sort()
            .map((k) => `${k}${g.attributes[k].itemSize}`)
            .join(",");
          const key = `${part.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${attrs}|${g.index ? "i" : "n"}`;
          const b = buckets.get(key) ?? { material: part.material, parts: [] };
          b.parts.push(part);
          buckets.set(key, b);
        }
      }
    }
    for (const child of [...o.children]) walk(child, slot);
  };
  walk(root, 0);

  // A mesh is hidden only if every part of it joins a batch of two or more.
  // Leaving one mesh out can leave a batch with a single part, whose other
  // meshes must then stay out too: settled by repeating until nothing moves.
  const lone = new Set<THREE.Mesh>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const { parts } of buckets.values()) {
      const joining = parts.filter((p) => !lone.has(p.mesh));
      if (joining.length === 1) {
        lone.add(joining[0].mesh);
        changed = true;
      }
    }
  }

  const added: THREE.Mesh[] = [];
  const hidden: THREE.Mesh[] = [];
  const m = new THREE.Matrix4();
  for (const { material, parts } of buckets.values()) {
    const joining = parts.filter((p) => !lone.has(p.mesh));
    if (joining.length < 2) continue;
    const geometries = joining.map((p) => {
      const g = p.owned ? p.geometry : p.geometry.clone();
      g.applyMatrix4(m.multiplyMatrices(toRoot, p.mesh.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) continue;
    const first = joining[0].mesh;
    const batch = new THREE.Mesh(merged, material);
    batch.name = "batch";
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    // Picking goes to the originals; the batch only draws.
    batch.raycast = () => {};
    root.add(batch);
    added.push(batch);
  }
  for (const mesh of sources) {
    if (lone.has(mesh)) continue;
    mesh.visible = false;
    hidden.push(mesh);
  }
  // Parts made for a split mesh that stayed whole are not needed.
  for (const { parts } of buckets.values()) for (const p of parts) if (p.owned && lone.has(p.mesh)) p.geometry.dispose();

  return () => {
    for (const undo of nested) undo();
    for (const b of added) {
      root.remove(b);
      b.geometry.dispose();
    }
    for (const mesh of hidden) mesh.visible = true;
  };
}

/** Marks every vertex of a part with its building's lift slot. */
function tagLift(p: Part, slot: number) {
  if (!p.owned) {
    p.geometry = p.geometry.clone();
    p.owned = true;
  }
  const n = p.geometry.attributes.position.count;
  p.geometry.setAttribute(LIFT_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
}

interface Part {
  mesh: THREE.Mesh;
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  /** Made here (a split): disposed here; otherwise the mesh's own, cloned before use. */
  owned: boolean;
}

/** A mesh as parts of one material each: itself, or its groups. Null if some part cannot be batched. */
function split(mesh: THREE.Mesh): Part[] | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const mat = mesh.material;
  if (!Array.isArray(mat)) return mat.transparent ? null : [{ mesh, material: mat, geometry: g, owned: false }];
  if (mat.length === 0) return null;
  if (mat.every((x) => x === mat[0])) {
    if (mat[0].transparent) return null;
    const whole = g.clone();
    whole.clearGroups();
    return [{ mesh, material: mat[0], geometry: whole, owned: true }];
  }
  if (g.groups.length === 0) return null;
  const parts: Part[] = [];
  for (const group of g.groups) {
    const material = mat[group.materialIndex ?? 0];
    if (!material || material.transparent) {
      for (const p of parts) p.geometry.dispose();
      return null;
    }
    parts.push({ mesh, material, geometry: extract(g, group.start, group.count), owned: true });
  }
  return parts;
}

/** The triangles of one group, as a geometry of their own (only the vertices they use). */
function extract(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(g.attributes);
  if (!g.index) {
    for (const n of names) {
      const a = g.attributes[n] as THREE.BufferAttribute;
      const s = a.itemSize;
      const arr = a.array as THREE.TypedArray;
      out.setAttribute(n, new THREE.BufferAttribute(arr.slice(start * s, (start + count) * s), s, a.normalized));
    }
    return out;
  }
  const index = g.index.array;
  const remap = new Map<number, number>();
  const order: number[] = [];
  const newIndex = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const v = index[start + i];
    let n = remap.get(v);
    if (n === undefined) {
      n = order.length;
      remap.set(v, n);
      order.push(v);
    }
    newIndex[i] = n;
  }
  for (const n of names) {
    const a = g.attributes[n] as THREE.BufferAttribute;
    const s = a.itemSize;
    const src = a.array as THREE.TypedArray;
    const dst = new (src.constructor as { new (n: number): THREE.TypedArray })(order.length * s);
    for (let i = 0; i < order.length; i++) for (let k = 0; k < s; k++) dst[i * s + k] = src[order[i] * s + k];
    out.setAttribute(n, new THREE.BufferAttribute(dst, s, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(order.length > 65535 ? newIndex : new Uint16Array(newIndex), 1));
  return out;
}

function batchable(mesh: THREE.Mesh): boolean {
  if (!mesh.visible || mesh.userData.noBatch) return false;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  const g = mesh.geometry as THREE.BufferGeometry;
  if (!g.attributes.position || Object.keys(g.morphAttributes).length > 0) return false;
  return mesh.matrixWorld.determinant() > 0;
}

/**
 * Opaque objects ordered by shader program, then material: each switch of
 * program re-sends every uniform of the material (lights, environment,
 * shadows), so drawing a program's objects together saves most of them.
 * three's own order (by material, then depth) interleaves programs.
 */
export function programSort(renderer: THREE.WebGLRenderer) {
  const programOf = (m: THREE.Material): number => {
    const p = (renderer.properties.get(m) as { currentProgram?: { id: number } }).currentProgram;
    return p ? p.id : 0;
  };
  const idOf = (m: THREE.Material) => (m as unknown as { id: number }).id;
  return (a: THREE.RenderItem, b: THREE.RenderItem): number =>
    a.groupOrder - b.groupOrder ||
    a.renderOrder - b.renderOrder ||
    programOf(a.material) - programOf(b.material) ||
    idOf(a.material) - idOf(b.material) ||
    a.z - b.z ||
    a.id - b.id;
}
