import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "@/lib/db/types";

/**
 * The file store, against a throwaway directory. It resolves its data file
 * from the working directory when first imported, so the directory is
 * redirected before the import — never touching the real `.data/`.
 */
let store: Store;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lifeos-store-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  store = (await import("@/lib/db/local-adapter")).localStore;
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("profile", () => {
  it("is null until one is saved", async () => {
    expect(await store.getProfile("nobody@test.dev")).toBeNull();
  });

  it("creates a profile with empty defaults for what was not given", async () => {
    const p = await store.saveProfile("a@test.dev", { name: "Camille" });
    expect(p).toMatchObject({ userKey: "a@test.dev", name: "Camille", profession: null, answers: {}, onboardedAt: null });
    expect(p.updatedAt).toBeTruthy();
  });

  it("keeps the fields a patch leaves out", async () => {
    await store.saveProfile("b@test.dev", { name: "Sam", profession: "Designer", onboardedAt: "2026-01-01T00:00:00.000Z" });
    await store.saveProfile("b@test.dev", { answers: { areas: ["clients"] } });
    expect(await store.getProfile("b@test.dev")).toMatchObject({
      name: "Sam",
      profession: "Designer",
      onboardedAt: "2026-01-01T00:00:00.000Z",
      answers: { areas: ["clients"] },
    });
  });

  it("belongs to one person only", async () => {
    await store.saveProfile("c@test.dev", { name: "C" });
    expect((await store.getProfile("a@test.dev"))?.name).toBe("Camille");
  });
});

describe("erasing someone's data", () => {
  it("removes every note, link and the profile — and nobody else's", async () => {
    const me = "erase@test.dev";
    const a = await store.insert(me, "brain", {
      category: "goals", kind: "goal", seedKey: null, title: "A", detail: null, done: false, ai: false,
    });
    const b = await store.insert(me, "brain", {
      category: "next", kind: "task", seedKey: null, title: "B", detail: null, done: false, ai: false,
    });
    await store.insert(me, "links", { fromId: a.id, toId: b.id, reason: null, origin: "user" });
    await store.saveProfile(me, { name: "Erase me" });
    await store.insert("keep@test.dev", "brain", {
      category: "ideas", kind: "idea", seedKey: null, title: "Keep", detail: null, done: false, ai: false,
    });

    await store.clear(me);

    expect(await store.list(me, "brain")).toEqual([]);
    expect(await store.list(me, "links")).toEqual([]);
    expect(await store.getProfile(me)).toBeNull();
    expect((await store.list("keep@test.dev", "brain")).map((n) => n.title)).toEqual(["Keep"]);
  });

  it("is safe to run twice", async () => {
    await store.clear("erase@test.dev");
    await expect(store.clear("erase@test.dev")).resolves.toBeUndefined();
  });
});
