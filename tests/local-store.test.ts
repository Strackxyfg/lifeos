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

describe("synapses in the file store", () => {
  it("has no migration to wait for", async () => {
    expect(await store.supportsSynapses()).toBe(true);
  });

  it("drops a note's links and dismissals with it, like the database cascade", async () => {
    const me = "cascade@test.dev";
    const mk = (title: string) =>
      store.insert(me, "brain", { category: "ideas", kind: "idea", seedKey: null, title, detail: null, done: false, ai: false });
    const [a, b, keep] = [await mk("A"), await mk("B"), await mk("Keep")];
    await store.insert(me, "links", { fromId: a.id, toId: b.id, reason: "r", origin: "ai", kind: "tension", sourceId: null });
    await store.insert(me, "dismissals", { fromId: a.id, toId: keep.id });
    await store.insert(me, "dismissals", { fromId: b.id, toId: keep.id });

    await store.remove(me, "brain", a.id);

    expect(await store.list(me, "links")).toEqual([]);
    const left = await store.list(me, "dismissals");
    expect(left.map((d) => [d.fromId, d.toId])).toEqual([[b.id, keep.id]]);
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

describe("recordings", () => {
  const bytes = new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4]);
  const file = "0f8fad5b-d9cb-469f-a165-70867728950e.webm";

  it("stores a recording in the owner's folder and reads it back", async () => {
    const path = await store.putAudio("voice@test.dev", file, bytes, "audio/webm;codecs=opus");
    expect(path.endsWith(`/${file}`)).toBe(true);
    expect(path).not.toContain("voice@test.dev"); // an email never becomes a path
    expect(await store.getAudio("voice@test.dev", path)).toEqual(bytes);
  });

  it("never serves or deletes another person's recording, even with its exact path", async () => {
    const path = await store.putAudio("owner@test.dev", file, bytes, "audio/webm");
    expect(await store.getAudio("intruder@test.dev", path)).toBeNull();
    await store.removeAudio("intruder@test.dev", [path]);
    expect(await store.getAudio("owner@test.dev", path)).toEqual(bytes);
  });

  it("refuses forged names and paths", async () => {
    await expect(store.putAudio("voice@test.dev", "../escape.webm", bytes, "audio/webm")).rejects.toThrow();
    await expect(store.putAudio("voice@test.dev", "x.exe", bytes, "audio/webm")).rejects.toThrow();
    const path = await store.putAudio("voice@test.dev", file, bytes, "audio/webm");
    const folder = path.split("/")[0];
    expect(await store.getAudio("voice@test.dev", `${folder}/../${folder}/${file}`)).toBeNull();
    expect(await store.getAudio("voice@test.dev", `${folder}/sub/${file}`)).toBeNull();
  });

  it("reads one row by id, only the owner's", async () => {
    const row = await store.insert("voice@test.dev", "audio", {
      path: "x/y.webm", mime: "audio/webm", bytes: 8, durationMs: 1000, language: "fr", transcript: [{ w: "Bon,", s: 0, e: 300 }],
    });
    expect((await store.get("voice@test.dev", "audio", row.id))?.transcript).toEqual([{ w: "Bon,", s: 0, e: 300 }]);
    expect(await store.get("intruder@test.dev", "audio", row.id)).toBeNull();
  });

  it("keeps a note, as text, when its recording is deleted", async () => {
    const rec = await store.insert("keep@test.dev", "audio", {
      path: "x/z.webm", mime: "audio/webm", bytes: 8, durationMs: 1000, language: null, transcript: [],
    });
    const note = await store.insert("keep@test.dev", "brain", {
      title: "Dit à voix haute", detail: null, category: "thoughts", kind: "thought", seedKey: null, done: false, ai: false,
      audioId: rec.id, audioStartMs: 0, audioEndMs: 900,
    });
    await store.remove("keep@test.dev", "audio", rec.id);
    const after = await store.get("keep@test.dev", "brain", note.id);
    expect(after).toMatchObject({ title: "Dit à voix haute", audioId: null, audioStartMs: null, audioEndMs: null });
  });

  it("erases the recordings with everything else", async () => {
    const path = await store.putAudio("gone@test.dev", file, bytes, "audio/webm");
    await store.clear("gone@test.dev");
    expect(await store.getAudio("gone@test.dev", path)).toBeNull();
  });
});

describe("the file stays whole", () => {
  it("loses no write when two copies of the store write at the same time", async () => {
    // Next.js bundles give each route its own copy of the module: simulate two.
    vi.resetModules();
    const other = (await import("@/lib/db/local-adapter")).localStore;
    expect(other).not.toBe(store);
    const writes = Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? store : other).insert("race@test.dev", "tasks", { labelKey: null, label: `t${i}`, done: false })
    );
    await Promise.all(writes);
    const labels = (await store.list("race@test.dev", "tasks")).map((t) => t.label).sort();
    expect(labels).toHaveLength(20);
  });

  it("refuses to write over a file it cannot read, and leaves it as it was", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const file = join(dir, ".data", "lifeos.json");
    const before = readFileSync(file, "utf8");
    const broken = before.slice(0, Math.floor(before.length / 2)); // a write cut in half
    writeFileSync(file, broken, "utf8");
    await expect(store.insert("race@test.dev", "tasks", { labelKey: null, label: "after", done: false })).rejects.toThrow(/cannot be read/);
    expect(readFileSync(file, "utf8")).toBe(broken);
    writeFileSync(file, before, "utf8");
    expect((await store.list("race@test.dev", "tasks")).length).toBe(20);
  });

  it("leaves no temporary file behind", async () => {
    const { readdirSync } = await import("node:fs");
    await store.insert("race@test.dev", "tasks", { labelKey: null, label: "clean", done: false });
    expect(readdirSync(join(dir, ".data")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("a recording's life", () => {
  const words = [{ w: "Bonjour.", s: 0, e: 400 }];
  const memo = () => new File([new Uint8Array([26, 69, 223, 163, 9, 9])], "memo.webm", { type: "audio/webm;codecs=opus" });
  const note = (title: string, audioId: string) => ({
    title, detail: null, category: "ideas" as const, kind: "idea" as const, seedKey: null, done: false, ai: false,
    audioId, audioStartMs: null, audioEndMs: null,
  });

  it("keeps the file and its transcript together", async () => {
    const { keepRecording } = await import("@/lib/brain/recordings");
    const id = await keepRecording(store, "life@test.dev", memo(), { words, durationMs: 400, language: "fr" });
    const row = await store.get("life@test.dev", "audio", id!);
    expect(row).toMatchObject({ mime: "audio/webm", bytes: 6, durationMs: 400, language: "fr", transcript: words });
    expect(await store.getAudio("life@test.dev", row!.path)).toHaveLength(6);
  });

  it("lets a recording go only with the last note said in it", async () => {
    const { keepRecording, releaseRecording } = await import("@/lib/brain/recordings");
    const id = (await keepRecording(store, "life@test.dev", memo(), { words, durationMs: 400, language: null }))!;
    const path = (await store.get("life@test.dev", "audio", id))!.path;
    const a = await store.insert("life@test.dev", "brain", note("Première idée", id));
    const b = await store.insert("life@test.dev", "brain", note("Seconde idée", id));

    await store.remove("life@test.dev", "brain", a.id);
    expect(await releaseRecording(store, "life@test.dev", id)).toBe(false); // "Seconde idée" still plays it
    expect(await store.getAudio("life@test.dev", path)).not.toBeNull();

    await store.remove("life@test.dev", "brain", b.id);
    expect(await releaseRecording(store, "life@test.dev", id)).toBe(true);
    expect(await store.get("life@test.dev", "audio", id)).toBeNull();
    expect(await store.getAudio("life@test.dev", path)).toBeNull();
  });

  it("removes the file when its row cannot be written: no audio nothing points to", async () => {
    const { keepRecording } = await import("@/lib/brain/recordings");
    const failing = { ...store, supportsVoice: store.supportsVoice.bind(store), putAudio: store.putAudio.bind(store),
      removeAudio: store.removeAudio.bind(store), insert: async () => { throw new Error("disk full"); } } as unknown as typeof store;
    const before = await import("node:fs").then(({ readdirSync }) => readdirSync(join(dir, ".data", "audio"), { recursive: true }).length);
    await expect(keepRecording(failing, "life@test.dev", memo(), { words, durationMs: 400, language: null })).rejects.toThrow("disk full");
    const after = await import("node:fs").then(({ readdirSync }) => readdirSync(join(dir, ".data", "audio"), { recursive: true }).length);
    expect(after).toBe(before);
  });
});
