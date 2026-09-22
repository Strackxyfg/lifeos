import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Collection, Dataset, DbProfile, ProfilePatch, Store } from "./types";
import { seedDataset, shouldSeed, EMPTY_DATASET } from "./seed";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "lifeos.json");

/** Per person: their collections, plus the profile that is not a collection. */
type UserRecord = Dataset & { profile?: DbProfile };
type FileShape = Record<string, UserRecord>;

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

  /**
   * A read that waits for pending writes. Reading the file directly could see
   * it half-written by a concurrent mutation, fail to parse, and report an
   * empty store.
   */
  private read<T>(fn: (data: FileShape) => T): Promise<T> {
    const next = this.queue.then(async () => fn(await this.readFile()));
    this.queue = next.catch(() => undefined);
    return next;
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
    // Files written before a collection existed don't have its key. Backfill
    // it, or the first read of a new collection returns `undefined` and the
    // first delete calls `.filter` on it.
    const set = data[userKey] as unknown as Record<string, unknown[]>;
    for (const key of Object.keys(EMPTY_DATASET)) {
      if (!Array.isArray(set[key])) set[key] = [];
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

      // Mirror the database's ON DELETE CASCADE: a note's links and
      // dismissals go with it. Without this the file store would keep
      // synapses to a deleted note.
      if (collection === "brain") {
        for (const dependent of ["links", "dismissals"] as const) {
          const rows = set[dependent] as unknown as { fromId: string; toId: string }[];
          set[dependent] = rows.filter((l) => l.fromId !== id && l.toId !== id) as unknown as { id: string }[];
        }
      }
    });
  }

  async getProfile(userKey: string): Promise<DbProfile | null> {
    return this.read((data) => data[userKey]?.profile ?? null);
  }

  async saveProfile(userKey: string, patch: ProfilePatch): Promise<DbProfile> {
    return this.mutate((data) => {
      const record = this.ensure(data, userKey) as UserRecord;
      const present = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const profile: DbProfile = {
        name: null,
        profession: null,
        answers: {},
        onboardedAt: null,
        ...record.profile,
        ...present,
        userKey,
        updatedAt: new Date().toISOString(),
      };
      record.profile = profile;
      return profile;
    });
  }

  /** The file store has no schema to migrate. */
  async supportsSynapses(): Promise<boolean> {
    return true;
  }

  async clear(userKey: string): Promise<void> {
    // Dropping the record rather than emptying it: the next read then starts
    // the person from scratch exactly as a first visit would.
    await this.mutate((data) => {
      delete data[userKey];
    });
  }
}

export const localStore = new LocalStore();
