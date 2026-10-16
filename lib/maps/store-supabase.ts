import { createAdminClient } from "@/lib/supabase/admin";
import { createRlsClient } from "@/lib/supabase/rls";
import { IMAGE_FILE, parseDoc } from "./model";
import type { MapMeta, MapRecord, MapStore, SaveResult, StoredImage } from "./store";

/**
 * Maps in Supabase (migration 016): rows in `lifeos_mind_maps` read through
 * the request's own session, so row-level security enforces ownership;
 * images in the private `lifeos-map-images` bucket, under "<user_key>/".
 */

const TABLE = "lifeos_mind_maps";
const BUCKET = "lifeos-map-images";
const META = "id, title, node_count, preview, revision, created_at, updated_at";

async function client() {
  return process.env.LIFEOS_DB_ADMIN === "1" ? createAdminClient() : createRlsClient();
}

type Row = { id: string; title: string; node_count: number; preview: string | null; revision: number; created_at: string; updated_at: string; doc?: unknown };

const meta = (r: Row): MapMeta => ({
  id: r.id,
  title: r.title,
  nodeCount: r.node_count,
  preview: r.preview,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether migration 016 is applied; a "no" is asked again a minute later. */
let probed: { value: boolean; until: number } | null = null;

export const supabaseMapStore: MapStore = {
  async supports() {
    if (probed && Date.now() < probed.until) return probed.value;
    const db = await client();
    const probes = await Promise.all([db.from(TABLE).select("id, revision, preview").limit(1), db.storage.from(BUCKET).list(undefined, { limit: 1 })]);
    const value = probes.every((p) => !p.error);
    probed = { value, until: value ? Number.POSITIVE_INFINITY : Date.now() + 60_000 };
    return value;
  },

  async list(userKey) {
    const db = await client();
    const { data, error } = await db.from(TABLE).select(META).eq("user_key", userKey).order("updated_at", { ascending: false });
    if (error) throw new Error(`[maps] list: ${error.message}`);
    return (data as Row[]).map(meta);
  },

  async get(userKey, id) {
    if (!UUID.test(id)) return null;
    const db = await client();
    const { data, error } = await db.from(TABLE).select(`${META}, doc`).eq("id", id).eq("user_key", userKey).maybeSingle();
    if (error) throw new Error(`[maps] get: ${error.message}`);
    if (!data) return null;
    // Read back through the same rules as a save: a row edited by hand cannot break the editor.
    const doc = parseDoc((data as Row).doc);
    if (!doc) return null;
    return { ...meta(data as Row), doc } satisfies MapRecord;
  },

  async create(userKey, input) {
    const db = await client();
    const { data, error } = await db
      .from(TABLE)
      .insert({ user_key: userKey, title: input.title, doc: input.doc, node_count: input.nodeCount, preview: input.preview ?? null })
      .select(`${META}, doc`)
      .single();
    if (error) throw new Error(`[maps] create: ${error.message}`);
    return { ...meta(data as Row), doc: input.doc };
  },

  async save(userKey, id, input, expected): Promise<SaveResult> {
    if (!UUID.test(id)) return { ok: false, reason: "missing" };
    const db = await client();
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { title: input.title, doc: input.doc, node_count: input.nodeCount, revision: expected + 1, updated_at: now };
    if (input.preview !== undefined) patch.preview = input.preview;
    // Only if nobody saved since `expected`: the revision is part of the condition.
    const { data, error } = await db.from(TABLE).update(patch).eq("id", id).eq("user_key", userKey).eq("revision", expected).select("revision, updated_at");
    if (error) throw new Error(`[maps] save: ${error.message}`);
    if (data && data.length === 1) return { ok: true, revision: data[0].revision as number, updatedAt: data[0].updated_at as string };
    const { data: current, error: readError } = await db.from(TABLE).select("revision, updated_at").eq("id", id).eq("user_key", userKey).maybeSingle();
    if (readError) throw new Error(`[maps] save: ${readError.message}`);
    if (!current) return { ok: false, reason: "missing" };
    return { ok: false, reason: "conflict", revision: current.revision as number, updatedAt: current.updated_at as string };
  },

  async remove(userKey, id) {
    if (!UUID.test(id)) return;
    const db = await client();
    const { error } = await db.from(TABLE).delete().eq("id", id).eq("user_key", userKey);
    if (error) throw new Error(`[maps] remove: ${error.message}`);
  },

  async putImage(userKey, file, bytes, mime) {
    if (!IMAGE_FILE.test(file)) throw new Error("Invalid image file name.");
    const db = await client();
    const { error } = await db.storage.from(BUCKET).upload(`${userKey}/${file}`, bytes, { contentType: mime, upsert: false });
    if (error) throw new Error(`[maps] store image: ${error.message}`);
  },

  async getImage(userKey, file) {
    if (!IMAGE_FILE.test(file)) return null;
    const db = await client();
    const { data, error } = await db.storage.from(BUCKET).download(`${userKey}/${file}`);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  },

  async listImages(userKey): Promise<StoredImage[]> {
    const db = await client();
    const out: StoredImage[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db.storage.from(BUCKET).list(userKey, { limit: 100, offset });
      if (error || !data || data.length === 0) break;
      for (const f of data) if (IMAGE_FILE.test(f.name)) out.push({ file: f.name, createdAt: f.created_at ?? new Date(0).toISOString() });
      if (data.length < 100) break;
    }
    return out;
  },

  async removeImages(userKey, files) {
    const own = files.filter((f) => IMAGE_FILE.test(f)).map((f) => `${userKey}/${f}`);
    if (own.length === 0) return;
    const db = await client();
    for (let i = 0; i < own.length; i += 100) {
      const { error } = await db.storage.from(BUCKET).remove(own.slice(i, i + 100));
      if (error) throw new Error(`[maps] remove images: ${error.message}`);
    }
  },

  async clear(userKey) {
    const db = await client();
    const { error } = await db.from(TABLE).delete().eq("user_key", userKey);
    // Migration 016 not applied: there is nothing to erase.
    if (error && !/PGRST205|42P01|schema cache|does not exist/i.test(`${error.code ?? ""} ${error.message}`)) throw new Error(`[maps] clear: ${error.message}`);
    const images = await this.listImages(userKey).catch(() => []);
    if (images.length) await this.removeImages(userKey, images.map((i) => i.file));
  },
};
