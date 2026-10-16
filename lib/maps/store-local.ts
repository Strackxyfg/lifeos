import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { IMAGE_FILE, type MapDoc } from "./model";
import type { MapMeta, MapRecord, MapStore, MapWrite, SaveResult, StoredImage } from "./store";

/**
 * Maps in the local data folder (no Supabase): `.data/maps.json`, images in
 * `.data/map-images/<folder>/`. Writes go through the same process-wide
 * queue as every other local file, to a temporary file renamed over the
 * old one — never seen half-written.
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "maps.json");
const IMAGES = path.join(DATA_DIR, "map-images");

interface Row {
  id: string;
  title: string;
  doc: MapDoc;
  preview: string | null;
  nodeCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
type Shape = Record<string, Row[]>;

const QUEUE = Symbol.for("lifeos.localStore.queue");
type Global = typeof globalThis & { [QUEUE]?: Promise<unknown> };

/** An image folder named by a hash: an email never becomes a path. */
const folderOf = (userKey: string) => createHash("sha256").update(`maps:${userKey}`).digest("hex").slice(0, 32);

async function readAll(): Promise<Shape> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
    return data as Shape;
  } catch {
    throw new Error(`[maps] ${FILE} cannot be read; nothing was written. Restore it or move it aside.`);
  }
}

async function writeAll(data: Shape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(data), "utf8");
    await fs.rename(temp, FILE);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Global;
  const next = (g[QUEUE] ?? Promise.resolve()).then(fn);
  g[QUEUE] = next.catch(() => undefined);
  return next;
}

const read = <T>(fn: (d: Shape) => T) => enqueue(async () => fn(await readAll()));
const mutate = <T>(fn: (d: Shape) => T) =>
  enqueue(async () => {
    const d = await readAll();
    const out = fn(d);
    await writeAll(d);
    return out;
  });

const meta = (r: Row): MapMeta => ({
  id: r.id,
  title: r.title,
  nodeCount: r.nodeCount,
  preview: r.preview,
  revision: r.revision,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const imagePath = (userKey: string, file: string) => {
  if (!IMAGE_FILE.test(file)) throw new Error("Invalid image file name.");
  return path.join(IMAGES, folderOf(userKey), file);
};

export const localMapStore: MapStore = {
  async supports() {
    return true;
  },

  list(userKey) {
    return read((d) => (d[userKey] ?? []).map(meta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  },

  get(userKey, id) {
    return read((d) => {
      const r = (d[userKey] ?? []).find((x) => x.id === id);
      return r ? ({ ...meta(r), doc: r.doc } satisfies MapRecord) : null;
    });
  },

  create(userKey, input: MapWrite) {
    return mutate((d) => {
      const now = new Date().toISOString();
      const row: Row = {
        id: randomUUID(),
        title: input.title,
        doc: input.doc,
        preview: input.preview ?? null,
        nodeCount: input.nodeCount,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      (d[userKey] ??= []).push(row);
      return { ...meta(row), doc: row.doc };
    });
  },

  save(userKey, id, input, expected): Promise<SaveResult> {
    return mutate((d) => {
      const row = (d[userKey] ?? []).find((x) => x.id === id);
      if (!row) return { ok: false, reason: "missing" } as const;
      if (row.revision !== expected) return { ok: false, reason: "conflict", revision: row.revision, updatedAt: row.updatedAt } as const;
      row.title = input.title;
      row.doc = input.doc;
      row.nodeCount = input.nodeCount;
      if (input.preview !== undefined) row.preview = input.preview;
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
      return { ok: true, revision: row.revision, updatedAt: row.updatedAt } as const;
    });
  },

  async remove(userKey, id) {
    await mutate((d) => {
      d[userKey] = (d[userKey] ?? []).filter((x) => x.id !== id);
    });
  },

  async putImage(userKey, file, bytes) {
    const p = imagePath(userKey, file);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, bytes);
  },

  async getImage(userKey, file) {
    try {
      return new Uint8Array(await fs.readFile(imagePath(userKey, file)));
    } catch {
      return null;
    }
  },

  async listImages(userKey): Promise<StoredImage[]> {
    const dir = path.join(IMAGES, folderOf(userKey));
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: StoredImage[] = [];
    for (const file of names) {
      if (!IMAGE_FILE.test(file)) continue;
      const st = await fs.stat(path.join(dir, file)).catch(() => null);
      if (st) out.push({ file, createdAt: st.mtime.toISOString() });
    }
    return out;
  },

  async removeImages(userKey, files) {
    for (const f of files) if (IMAGE_FILE.test(f)) await fs.rm(imagePath(userKey, f), { force: true });
  },

  async clear(userKey) {
    await mutate((d) => {
      delete d[userKey];
    });
    await fs.rm(path.join(IMAGES, folderOf(userKey)), { recursive: true, force: true });
  },
};
