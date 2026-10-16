import "server-only";
import { isSupabaseConfigured } from "@/lib/db/store";
import type { MapDoc } from "./model";
import { localMapStore } from "./store-local";
import { supabaseMapStore } from "./store-supabase";

/**
 * Where maps are kept: the database when Supabase is configured (migration
 * 016), the local data folder otherwise — one contract for both.
 *
 * A save names the revision it started from; if the map has moved on since
 * (another tab, another device), nothing is overwritten and the caller is
 * told. Images live beside the maps, each person's in their own folder,
 * named by a random id and an image extension (`IMAGE_FILE`), nothing else.
 */

export interface MapMeta {
  id: string;
  title: string;
  nodeCount: number;
  /** A small SVG of the map, for the gallery. */
  preview: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MapRecord extends MapMeta {
  doc: MapDoc;
}

export interface MapWrite {
  title: string;
  doc: MapDoc;
  nodeCount: number;
  /** Left as it is when undefined. */
  preview?: string | null;
}

export type SaveResult =
  | { ok: true; revision: number; updatedAt: string }
  | { ok: false; reason: "conflict"; revision: number; updatedAt: string }
  | { ok: false; reason: "missing" };

export interface StoredImage {
  file: string;
  createdAt: string;
}

export interface MapStore {
  /** Whether migration 016 is in place (always, for the local folder). */
  supports(): Promise<boolean>;
  /** The person's maps, most recently changed first — without their documents. */
  list(userKey: string): Promise<MapMeta[]>;
  get(userKey: string, id: string): Promise<MapRecord | null>;
  create(userKey: string, input: MapWrite): Promise<MapRecord>;
  save(userKey: string, id: string, input: MapWrite, expectedRevision: number): Promise<SaveResult>;
  remove(userKey: string, id: string): Promise<void>;
  putImage(userKey: string, file: string, bytes: Uint8Array, mime: string): Promise<void>;
  getImage(userKey: string, file: string): Promise<Uint8Array | null>;
  listImages(userKey: string): Promise<StoredImage[]>;
  removeImages(userKey: string, files: string[]): Promise<void>;
  /** Everything: every map and every image. */
  clear(userKey: string): Promise<void>;
}

export function getMapStore(): MapStore {
  return isSupabaseConfigured() ? supabaseMapStore : localMapStore;
}

/** The images a set of documents uses. */
export function imagesUsed(docs: MapDoc[]): Set<string> {
  const used = new Set<string>();
  for (const d of docs) for (const n of Object.values(d.nodes)) if (n.image) used.add(n.image.file);
  return used;
}

/**
 * Removes the person's images no map uses any more — but never one uploaded
 * in the last day: it may belong to an edit not saved yet, or be brought
 * back by an undo.
 */
export async function collectImages(store: MapStore, userKey: string, now = Date.now()): Promise<number> {
  const metas = await store.list(userKey);
  const docs = (await Promise.all(metas.map((m) => store.get(userKey, m.id)))).filter((r): r is MapRecord => !!r).map((r) => r.doc);
  const used = imagesUsed(docs);
  const stale = (await store.listImages(userKey)).filter((i) => !used.has(i.file) && now - Date.parse(i.createdAt) > 24 * 3600_000).map((i) => i.file);
  if (stale.length) await store.removeImages(userKey, stale);
  return stale.length;
}
