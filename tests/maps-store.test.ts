import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where maps are kept without Supabase: one person's maps and images never
 * reach another's, a save from a stale copy never overwrites a newer one,
 * images no map uses go (but not fresh ones), and the complete export and
 * the erasure both include maps.
 */
let dir: string;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lifeos-maps-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});

const IMG_A = "0123456789abcdef.png";
const IMG_B = "fedcba9876543210.webp";

describe("the local map store", () => {
  it("keeps each person's maps apart, newest first, and refuses a stale save", async () => {
    const { getMapStore } = await import("@/lib/maps/store");
    const { newDoc, updateNode } = await import("@/lib/maps/model");
    const store = getMapStore();
    expect(await store.supports()).toBe(true);

    const doc = newDoc("Plan");
    const a = await store.create("ada@x.test", { title: "Plan", doc, nodeCount: 1, preview: "<svg/>" });
    const b = await store.create("ada@x.test", { title: "Second", doc: newDoc("Second"), nodeCount: 1 });
    await store.create("eve@x.test", { title: "Eve's", doc: newDoc("Eve's"), nodeCount: 1 });
    expect(a.revision).toBe(1);

    // Another person never sees, reads, saves or removes it.
    expect((await store.list("eve@x.test")).map((m) => m.title)).toEqual(["Eve's"]);
    expect(await store.get("eve@x.test", a.id)).toBeNull();
    expect(await store.save("eve@x.test", a.id, { title: "x", doc, nodeCount: 1 }, 1)).toEqual({ ok: false, reason: "missing" });
    await store.remove("eve@x.test", a.id);
    expect(await store.get("ada@x.test", a.id)).not.toBeNull();

    const edited = updateNode(doc, doc.root, { text: "Plan v2" });
    const first = await store.save("ada@x.test", a.id, { title: "Plan v2", doc: edited, nodeCount: 1 }, 1);
    expect(first).toMatchObject({ ok: true, revision: 2 });
    // A save from the copy opened before: told, nothing overwritten.
    const stale = await store.save("ada@x.test", a.id, { title: "Old", doc, nodeCount: 1 }, 1);
    expect(stale).toMatchObject({ ok: false, reason: "conflict", revision: 2 });
    const now = await store.get("ada@x.test", a.id);
    expect(now?.title).toBe("Plan v2");
    // The preview is kept when a save does not bring one.
    expect(now?.preview).toBe("<svg/>");

    const list = await store.list("ada@x.test");
    expect(list.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(list[0]).not.toHaveProperty("doc");
  });

  it("keeps images per person, by safe names only, and collects the unused ones a day later", async () => {
    const { getMapStore, collectImages } = await import("@/lib/maps/store");
    const { newDoc, updateNode } = await import("@/lib/maps/model");
    const store = getMapStore();
    await store.putImage("ada@x.test", IMG_A, new Uint8Array([1, 2, 3]), "image/png");
    await store.putImage("ada@x.test", IMG_B, new Uint8Array([4, 5]), "image/webp");
    await expect(store.putImage("ada@x.test", "../../escape.png", new Uint8Array([1]), "image/png")).rejects.toThrow();
    expect(await store.getImage("eve@x.test", IMG_A)).toBeNull();
    expect(Array.from((await store.getImage("ada@x.test", IMG_A))!)).toEqual([1, 2, 3]);
    // Folders are named by a hash: no email in a path.
    expect(readdirSync(join(dir, ".data", "map-images")).every((d) => /^[a-f0-9]{32}$/.test(d))).toBe(true);

    const doc = newDoc("Images");
    const withImage = updateNode(doc, doc.root, { image: { file: IMG_A, width: 10, height: 10 } });
    await store.create("ada@x.test", { title: "Images", doc: withImage, nodeCount: 1 });

    // Uploaded just now: kept even though no map uses it yet.
    expect(await collectImages(store, "ada@x.test")).toBe(0);
    const folder = readdirSync(join(dir, ".data", "map-images"))[0];
    const old = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(join(dir, ".data", "map-images", folder, IMG_B), old, old);
    utimesSync(join(dir, ".data", "map-images", folder, IMG_A), old, old);
    expect(await collectImages(store, "ada@x.test")).toBe(1);
    expect(await store.getImage("ada@x.test", IMG_B)).toBeNull();
    expect(await store.getImage("ada@x.test", IMG_A)).not.toBeNull();
  });

  it("is in the complete export, and erased with the rest", async () => {
    const { loadWorkspaceExport } = await import("@/lib/export/workspace");
    const { getMapStore } = await import("@/lib/maps/store");
    const out = await loadWorkspaceExport("ada@x.test");
    expect(out.maps.map((m) => m.title).sort()).toEqual(["Images", "Plan v2", "Second"]);
    expect(out.maps.every((m) => m.doc && m.doc.nodes[m.doc.root])).toBe(true);
    expect(JSON.stringify(out.maps)).not.toContain("Eve's");

    const store = getMapStore();
    await store.clear("ada@x.test");
    expect(await store.list("ada@x.test")).toEqual([]);
    expect(await store.getImage("ada@x.test", IMG_A)).toBeNull();
    expect((await store.list("eve@x.test")).length).toBe(1);
  });
});
