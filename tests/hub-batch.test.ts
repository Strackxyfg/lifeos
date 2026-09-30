import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { batchStatic } from "@/components/hub/scene/batch";

/**
 * Batching a still subtree: fewer draws, the same triangles in the same
 * places, the moving parts and the see-through ones left alone, and the
 * originals kept (hidden) for picking — undone exactly.
 */

const white = new THREE.MeshStandardMaterial({ color: "#ffffff" });
const metal = new THREE.MeshStandardMaterial({ color: "#333333" });
const inside = new THREE.MeshStandardMaterial({ color: "#eeeeee" });
const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 });

function box(material: THREE.Material | THREE.Material[], x: number, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const drawn = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

const triangles = (meshes: THREE.Mesh[]) =>
  meshes.reduce((n, m) => {
    const g = m.geometry as THREE.BufferGeometry;
    if (Array.isArray(m.material) && g.groups.length) return n + g.groups.reduce((k, gr) => k + gr.count / 3, 0);
    return n + (g.index ? g.index.count : g.attributes.position.count) / 3;
  }, 0);

/** World-space bounding box of what is drawn. */
const bounds = (root: THREE.Object3D) => {
  const b = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  // Precise: from the vertices themselves, not a transformed box.
  for (const m of drawn(root)) b.union(new THREE.Box3().setFromObject(m, true));
  return b;
};

describe("batching a still subtree", () => {
  it("merges meshes that share a material, keeps triangles and places", () => {
    const root = new THREE.Group();
    root.position.set(10, 0, -4);
    root.rotation.y = 0.7;
    const a = box(white, 0);
    const b = box(white, 2, 1);
    const c = box(white, -2, 0, 3);
    const d = box(metal, 0, 3);
    root.add(a, b, c, d);
    const before = { draws: drawn(root).length, tris: triangles(drawn(root)), box: bounds(root) };

    const undo = batchStatic(root);
    const after = drawn(root);
    expect(after.length).toBe(2); // the white batch, and the lone metal box
    expect(triangles(after)).toBe(before.tris);
    expect(bounds(root).min.distanceTo(before.box.min)).toBeLessThan(1e-5);
    expect(bounds(root).max.distanceTo(before.box.max)).toBeLessThan(1e-5);
    // The originals are still there for picking, just not drawn; the batch cannot be picked.
    expect([a, b, c].every((m) => m.parent === root && !m.visible)).toBe(true);
    expect(d.visible).toBe(true);
    const batch = after.find((m) => m.name === "batch")!;
    const hits: THREE.Intersection[] = [];
    batch.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
    expect(batch.castShadow && batch.receiveShadow).toBe(true);

    undo();
    expect(drawn(root)).toHaveLength(4);
    expect(root.children.some((o) => o.name === "batch")).toBe(false);
  });

  it("merges a moving part apart, in its own frame, and leaves see-through parts alone", () => {
    const root = new THREE.Group();
    const hand = new THREE.Group();
    hand.userData.dynamic = true;
    const h1 = box(white, 5);
    const h2 = box(white, 6);
    hand.add(h1, h2);
    const pane1 = box(glass, 0);
    const pane2 = box(glass, 1);
    root.add(box(white, 0), box(white, 1), hand, pane1, pane2);
    batchStatic(root);
    const d = drawn(root);
    // The still white boxes in one batch; the hand's two in another, inside the hand; both panes as they were.
    expect(d.filter((m) => m.name === "batch")).toHaveLength(2);
    expect(d).toHaveLength(4);
    const handBatch = hand.children.find((o) => o.name === "batch") as THREE.Mesh;
    expect(handBatch).toBeDefined();
    expect(h1.visible || h2.visible).toBe(false);
    expect(pane1.visible && pane2.visible).toBe(true);
    // The hand still moves its parts: the batch goes with it.
    const before = new THREE.Box3().setFromObject(handBatch, true);
    hand.rotation.y = Math.PI / 2;
    root.updateWorldMatrix(true, true);
    const after = new THREE.Box3().setFromObject(handBatch, true);
    expect(after.min.distanceTo(before.min)).toBeGreaterThan(0.5);
  });

  it("tags each vertex with its building's lift slot when merging across buildings", () => {
    const root = new THREE.Group();
    const a = new THREE.Group();
    a.userData.liftSlot = 2;
    a.add(box(white, 0));
    const b = new THREE.Group();
    b.userData.liftSlot = 3;
    b.add(box(white, 4));
    root.add(a, b, box(white, 8)); // the last is ground: slot 0
    batchStatic(root, { lift: true });
    const batch = drawn(root).find((m) => m.name === "batch")!;
    const ids = Array.from((batch.geometry as THREE.BufferGeometry).getAttribute("liftId").array as Float32Array);
    expect(new Set(ids)).toEqual(new Set([0, 2, 3]));
    expect(ids.filter((x) => x === 2)).toHaveLength(24); // a box's 24 vertices
  });

  it("splits a shell of several materials into the batches of its materials", () => {
    const root = new THREE.Group();
    // A box whose six faces are three materials (two faces each).
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.clearGroups();
    g.addGroup(0, 12, 0);
    g.addGroup(12, 12, 1);
    g.addGroup(24, 12, 2);
    const shell = new THREE.Mesh(g, [white, inside, metal]);
    shell.castShadow = shell.receiveShadow = true;
    const others = [box(white, 3), box(inside, 4), box(metal, 5)];
    root.add(shell, ...others);
    const tris = triangles(drawn(root));

    batchStatic(root);
    const d = drawn(root);
    expect(d).toHaveLength(3); // one batch per material, the shell's parts inside them
    expect(new Set(d.map((m) => m.material))).toEqual(new Set([white, inside, metal]));
    expect(triangles(d)).toBe(tris);
    expect(shell.visible).toBe(false);
  });

  it("never hides a mesh whose material found no partner", () => {
    const root = new THREE.Group();
    // The shell's metal part is the only metal: the shell stays whole and drawn,
    // and the white box that could have joined it stays drawn too.
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.clearGroups();
    g.addGroup(0, 18, 0);
    g.addGroup(18, 18, 1);
    const shell = new THREE.Mesh(g, [white, metal]);
    shell.castShadow = shell.receiveShadow = true;
    const lone = box(white, 3);
    root.add(shell, lone);
    const tris = triangles(drawn(root));
    batchStatic(root);
    expect(shell.visible && lone.visible).toBe(true);
    expect(drawn(root).some((m) => m.name === "batch")).toBe(false);
    expect(triangles(drawn(root))).toBe(tris);
  });

  it("does not merge mirrored meshes (their winding would flip)", () => {
    const root = new THREE.Group();
    const flipped = box(white, 2);
    flipped.scale.x = -1;
    root.add(box(white, 0), box(white, 1), flipped);
    batchStatic(root);
    expect(flipped.visible).toBe(true);
    expect(drawn(root)).toHaveLength(2);
  });
});
