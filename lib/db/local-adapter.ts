import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Collection, Dataset, Store } from "./types";
import { seedDataset, shouldSeed, EMPTY_DATASET } from "./seed";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "lifeos.json");

type FileShape = Record<string, Dataset>;

/**
 * File-backed store used when Supabase env vars are absent.
 * Real persistence (survives reloads and server restarts) with no external
 * service — the same contract the Supabase adapter implements, so swapping
 * backends needs no component changes.
 *
 * Writes are serialized through a promise chain to avoid interleaved
 * read-modify-write races between concurrent server actions.
 */
class LocalStore implements Store {
  readonly backend = "local" as const;
  private queue: Promise<unknown> = Promise.resolve();

  private async readFile(): Promise<FileShape> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      return JSON.parse(raw) as FileShape;
    } catch {
      return {};
    }
  }

  private async writeFile(data: FileShape): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  }

  /** Runs a read-modify-write atomically with respect to other mutations. */
  private mutate<T>(fn: (data: FileShape) => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      const data = await this.readFile();
      const result = await fn(data);
      await this.writeFile(data);
      return result;
    });
    // Keep the chain alive even if one mutation throws.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private ensure(data: FileShape, userKey: string): Dataset {
    if (!data[userKey]) {
      // Real accounts start empty; only the demo identity gets sample content.
      data[userKey] = shouldSeed(userKey)
        ? seedDataset(userKey)
        : structuredClone(EMPTY_DATASET);
    }
    return data[userKey];
  }

  async list<C extends Collection>(userKey: string, collection: C): Promise<Dataset[C]> {
    // Seeding a first-time user is itself a write, so route through mutate.
    return this.mutate((data) => this.ensure(data, userKey)[collection]);
  }

  async insert<C extends Collection>(
    userKey: string,
    collection: C,
    row: Omit<Dataset[C][number], "id" | "userKey" | "createdAt">
  ): Promise<Dataset[C][number]> {
    return this.mutate((data) => {
      const set = this.ensure(data, userKey);
      const created = {
        ...row,
        id: randomUUID(),
        userKey,
        createdAt: new Date().toISOString(),
      } as Dataset[C][number];
      (set[collection] as Dataset[C][number][]).unshift(created);
      return created;
    });
  }

  async update<C extends Collection>(
    userKey: string,
    collection: C,
    id: string,
    patch: Partial<Dataset[C][number]>
  ): Promise<void> {
    await this.mutate((data) => {
      const rows = this.ensure(data, userKey)[collection] as Dataset[C][number][];
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows[i] = { ...rows[i], ...patch, id, userKey };
    });
  }

  async remove(userKey: string, collection: Collection, id: string): Promise<void> {
    await this.mutate((data) => {
      // Indexing a union-typed key needs a widened view to assign back.
      const set = this.ensure(data, userKey) as unknown as Record<string, { id: string }[]>;
      set[collection] = set[collection].filter((r) => r.id !== id);
    });
  }
}

export const localStore = new LocalStore();
