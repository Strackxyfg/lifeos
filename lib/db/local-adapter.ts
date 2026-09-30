import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertAudioFile, fileInFolder } from "./audio-files";
import type { Collection, Dataset, DbProfile, ProfilePatch, Store } from "./types";
import { seedDataset, shouldSeed, EMPTY_DATASET } from "./seed";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "lifeos.json");
const AUDIO_DIR = path.join(DATA_DIR, "audio");

/** A person's recordings folder: named by a hash, so an email never becomes a path. */
const audioFolder = (userKey: string) => createHash("sha256").update(userKey).digest("hex").slice(0, 32);

/** Per person: their collections, plus the profile that is not a collection. */
type UserRecord = Dataset & { profile?: DbProfile };
type FileShape = Record<string, UserRecord>;

/**
 * One queue for the whole process. Next.js builds route handlers, pages and
 * server actions into separate bundles, and each bundle has its own copy of
 * this module — so a queue held by the instance serialised only that copy's
 * writes. A route and a server action could then read and write the file at
 * the same time, and one would overwrite what the other had just written.
 * Kept on `globalThis`, every copy shares it.
 */
const QUEUE = Symbol.for("lifeos.localStore.queue");
type Global = typeof globalThis & { [QUEUE]?: Promise<unknown> };

/**
 * File-backed store used when Supabase env vars are absent.
 * Real persistence (survives reloads and server restarts) with no external
 * service — the same contract the Supabase adapter implements, so swapping
 * backends needs no component changes.
 *
 * Three rules keep the file whole:
 * - every read-modify-write goes through one queue for the process (above);
 * - a write goes to a temporary file that then replaces the data file, so
 *   the file is never seen half-written;
 * - a file that exists but cannot be read stops the write instead of being
 *   taken for an empty store. It used to be: a read that met a half-written
 *   file returned "nothing", and the next write replaced every person's data
 *   with that nothing.
 */
class LocalStore implements Store {
  readonly backend = "local" as const;

  private get queue(): Promise<unknown> {
    return (globalThis as Global)[QUEUE] ?? Promise.resolve();
  }

  private set queue(next: Promise<unknown>) {
    (globalThis as Global)[QUEUE] = next;
  }

  private async readFile(): Promise<FileShape> {
    let raw: string;
    try {
      raw = await fs.readFile(DATA_FILE, "utf8");
    } catch (err) {
      // No file yet: an empty store, legitimately.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    try {
      const data = JSON.parse(raw) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
      return data as FileShape;
    } catch {
      throw new Error(`[local store] ${DATA_FILE} cannot be read; nothing was written. Restore it or move it aside.`);
    }
  }

  private async writeFile(data: FileShape): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temp = `${DATA_FILE}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
      await fs.rename(temp, DATA_FILE);
    } catch (err) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** A read that waits for pending writes, so it never sees one halfway. */
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

  async get<C extends Collection>(userKey: string, collection: C, id: string): Promise<Dataset[C][number] | null> {
    const rows = await this.list(userKey, collection);
    return (rows as Dataset[C][number][]).find((r) => r.id === id) ?? null;
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
      // A reminder outlives the note it was about (ON DELETE SET NULL), and
      // so does a check-in the note was the answer of.
      if (collection === "brain") {
        for (const r of set.reminders as unknown as { noteId?: string | null }[]) {
          if (r.noteId === id) r.noteId = null;
        }
        for (const c of set.checkins as unknown as { noteId?: string | null }[]) {
          if (c.noteId === id) c.noteId = null;
        }
      }
      // And the deal whose next action it was.
      if (collection === "deals") {
        for (const r of set.reminders as unknown as { dealId?: string | null }[]) {
          if (r.dealId === id) r.dealId = null;
        }
      }
      // And its ON DELETE SET NULL: a note outlives its recording, as text.
      if (collection === "audio") {
        const notes = set.brain as unknown as { audioId?: string | null; audioStartMs?: number | null; audioEndMs?: number | null }[];
        for (const n of notes) {
          if (n.audioId === id) {
            n.audioId = null;
            n.audioStartMs = null;
            n.audioEndMs = null;
          }
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

  async supportsMemory(): Promise<boolean> {
    return true;
  }

  async supportsVoice(): Promise<boolean> {
    return true;
  }

  async supportsReminders(): Promise<boolean> {
    return true;
  }

  async supportsFounder(): Promise<boolean> {
    return true;
  }

  async supportsSelf(): Promise<boolean> {
    return true;
  }

  async putAudio(userKey: string, file: string, bytes: Uint8Array, _mime: string): Promise<string> {
    assertAudioFile(file);
    const folder = audioFolder(userKey);
    await fs.mkdir(path.join(AUDIO_DIR, folder), { recursive: true });
    await fs.writeFile(path.join(AUDIO_DIR, folder, file), bytes);
    return `${folder}/${file}`;
  }

  async getAudio(userKey: string, stored: string): Promise<Uint8Array | null> {
    const folder = audioFolder(userKey);
    const file = fileInFolder(folder, stored);
    if (!file) return null;
    try {
      return new Uint8Array(await fs.readFile(path.join(AUDIO_DIR, folder, file)));
    } catch {
      return null;
    }
  }

  async removeAudio(userKey: string, paths: string[]): Promise<void> {
    const folder = audioFolder(userKey);
    for (const stored of paths) {
      const file = fileInFolder(folder, stored);
      if (file) await fs.rm(path.join(AUDIO_DIR, folder, file), { force: true });
    }
  }

  async clear(userKey: string): Promise<void> {
    // Dropping the record rather than emptying it: the next read then starts
    // the person from scratch exactly as a first visit would.
    await this.mutate((data) => {
      delete data[userKey];
    });
    // Recordings are files beside the data: they go too.
    await fs.rm(path.join(AUDIO_DIR, audioFolder(userKey)), { recursive: true, force: true });
  }
}

export const localStore = new LocalStore();
