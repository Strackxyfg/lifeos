import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "@/lib/db/data-dir";

/**
 * A JSON file of the local data folder (sales, specialists…), read and
 * written through the same process-wide queue as every other local file,
 * and replaced atomically (written aside, then renamed).
 */

const QUEUE = Symbol.for("lifeos.localStore.queue");
type Global = typeof globalThis & { [QUEUE]?: Promise<unknown> };

export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Global;
  const next = (g[QUEUE] ?? Promise.resolve()).then(fn);
  g[QUEUE] = next.catch(() => undefined);
  return next;
}

export function jsonFile<T extends object>(name: string, empty: () => T) {
  const file = () => path.join(dataDir(), name);

  async function readAll(): Promise<T> {
    let raw: string;
    try {
      raw = await fs.readFile(file(), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw err;
    }
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${name} cannot be read; nothing was written.`);
    return data as T;
  }

  async function writeAll(data: T): Promise<void> {
    await fs.mkdir(dataDir(), { recursive: true });
    const temp = `${file()}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(data), "utf8");
      await fs.rename(temp, file());
    } catch (err) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw err;
    }
  }

  return {
    read: <R>(fn: (d: T) => R) => enqueue(async () => fn(await readAll())),
    mutate: <R>(fn: (d: T) => R) =>
      enqueue(async () => {
        const d = await readAll();
        const out = fn(d);
        await writeAll(d);
        return out;
      }),
  };
}
