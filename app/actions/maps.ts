"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAuthenticatedUserKey } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";
import { loadBrainView } from "@/lib/brain/load";
import { relationText } from "@/lib/brain/labels";
import { LIMITS, fromOutline, label, nodeCount, parseDoc, updateNode, type MapDoc } from "@/lib/maps/model";
import { collectImages, getMapStore, type MapStore } from "@/lib/maps/store";
import { MAX_IMAGE_BYTES, imageInfo } from "@/lib/maps/image";
import { outlineFromNote } from "@/lib/maps/from-note";

/**
 * Mind maps: every write here names its caller strictly (never a fallback
 * identity) and passes the document through `parseDoc` — what reaches the
 * database is always a valid, bounded tree, whatever the client sent.
 */

export type MapsCode = "unauthorized" | "unavailable" | "invalid" | "too_large" | "missing" | "conflict" | "failed";
export type MapsResult<T = object> = ({ ok: true } & T) | { ok: false; code: MapsCode; revision?: number; updatedAt?: string };

const MAX_DOC_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW = 200_000;

class Refusal extends Error {
  constructor(public code: MapsCode) {
    super(code);
  }
}

async function ctx(): Promise<{ userKey: string; store: MapStore }> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) throw new Refusal("unauthorized");
  const store = getMapStore();
  if (!(await store.supports())) throw new Refusal("unavailable");
  return { userKey, store };
}

function fail(err: unknown): { ok: false; code: MapsCode } {
  if (err instanceof Refusal) return { ok: false, code: err.code };
  console.error("[maps]", err);
  return { ok: false, code: "failed" };
}

/** A document checked and measured, ready to store. */
function prepared(raw: unknown): { doc: MapDoc; title: string; nodeCount: number } {
  const doc = parseDoc(raw);
  if (!doc) throw new Refusal("invalid");
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) throw new Refusal("too_large");
  const title = label(doc.nodes[doc.root]).replace(/\s+/g, " ").trim().slice(0, 200) || "…";
  return { doc, title, nodeCount: nodeCount(doc) };
}

/** A preview is the editor's SVG; anything else is ignored (it is only ever shown as an <img>). */
const previewOf = (v: unknown): string | null | undefined =>
  v === undefined ? undefined : typeof v === "string" && v.startsWith("<svg") && v.length <= MAX_PREVIEW ? v : null;

const refresh = (id?: string) => {
  revalidatePath("/brain/maps");
  if (id) revalidatePath(`/brain/maps/${id}`);
};

export async function createMap(input: { doc: unknown; preview?: unknown }): Promise<MapsResult<{ id: string }>> {
  try {
    const { userKey, store } = await ctx();
    const ready = prepared(input?.doc);
    const made = await store.create(userKey, { ...ready, preview: previewOf(input?.preview) ?? null });
    refresh();
    return { ok: true, id: made.id };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Saves a map if nobody saved it since `revision`; otherwise says so (with
 * the revision it is now at) and changes nothing.
 */
export async function saveMap(id: string, input: { doc: unknown; preview?: unknown }, revision: number): Promise<MapsResult<{ revision: number; updatedAt: string }>> {
  try {
    if (typeof id !== "string" || !Number.isInteger(revision) || revision < 1) throw new Refusal("invalid");
    const { userKey, store } = await ctx();
    const ready = prepared(input?.doc);
    const res = await store.save(userKey, id, { ...ready, preview: previewOf(input?.preview) }, revision);
    if (!res.ok) return res.reason === "missing" ? { ok: false, code: "missing" } : { ok: false, code: "conflict", revision: res.revision, updatedAt: res.updatedAt };
    revalidatePath("/brain/maps");
    return { ok: true, revision: res.revision, updatedAt: res.updatedAt };
  } catch (e) {
    return fail(e);
  }
}

/** The map as it is stored now: to load the version another tab or device saved. */
export async function loadMap(id: string): Promise<MapsResult<{ doc: MapDoc; revision: number; updatedAt: string }>> {
  try {
    const { userKey, store } = await ctx();
    const current = typeof id === "string" ? await store.get(userKey, id) : null;
    if (!current) throw new Refusal("missing");
    return { ok: true, doc: current.doc, revision: current.revision, updatedAt: current.updatedAt };
  } catch (e) {
    return fail(e);
  }
}

export async function renameMap(id: string, title: string): Promise<MapsResult<{ revision: number }>> {
  try {
    const { userKey, store } = await ctx();
    const current = await store.get(userKey, id);
    if (!current) throw new Refusal("missing");
    const clean = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.text);
    if (!clean) throw new Refusal("invalid");
    const ready = prepared(updateNode(current.doc, current.doc.root, { text: clean }));
    const res = await store.save(userKey, id, ready, current.revision);
    if (!res.ok) return res.reason === "missing" ? { ok: false, code: "missing" } : { ok: false, code: "conflict", revision: res.revision };
    refresh(id);
    return { ok: true, revision: res.revision };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicateMap(id: string): Promise<MapsResult<{ id: string }>> {
  try {
    const { userKey, store } = await ctx();
    const current = await store.get(userKey, id);
    if (!current) throw new Refusal("missing");
    const m = await getMessages();
    const root = current.doc.nodes[current.doc.root];
    const copy = updateNode(current.doc, current.doc.root, { text: `${root.text} ${m.maps.copySuffix}`.slice(0, LIMITS.text) });
    const made = await store.create(userKey, { ...prepared(copy), preview: current.preview });
    refresh();
    return { ok: true, id: made.id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteMap(id: string): Promise<MapsResult> {
  try {
    const { userKey, store } = await ctx();
    await store.remove(userKey, id);
    // Images only this map used go with it (those added in the last day stay: see collectImages).
    await collectImages(store, userKey).catch((err) => console.error("[maps] image cleanup", err));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Stores an image for an idea. What it is comes from its bytes (PNG, JPEG,
 * WebP or GIF — never an SVG), and so does its size, which the map uses.
 */
export async function uploadMapImage(form: FormData): Promise<MapsResult<{ file: string; width: number; height: number }>> {
  try {
    const { userKey, store } = await ctx();
    const blob = form.get("image");
    if (!(blob instanceof Blob)) throw new Refusal("invalid");
    if (blob.size > MAX_IMAGE_BYTES) throw new Refusal("too_large");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = imageInfo(bytes);
    if (!info) throw new Refusal("invalid");
    const file = `${randomUUID()}.${info.ext}`;
    await store.putImage(userKey, file, bytes, info.mime);
    return { ok: true, file, width: info.width, height: info.height };
  } catch (e) {
    return fail(e);
  }
}

/** A map drawn from a note of the brain and its connections (lib/maps/from-note.ts). */
export async function createMapFromNote(noteId: string): Promise<MapsResult<{ id: string }>> {
  try {
    const { userKey, store } = await ctx();
    const m = await getMessages();
    const { notes, links } = await loadBrainView(m);
    const outline = outlineFromNote(String(noteId ?? ""), notes, links, (kind, side) => relationText(kind, side, m));
    if (!outline) throw new Refusal("missing");
    const made = await store.create(userKey, { ...prepared(fromOutline(outline, { theme: "midnight", layout: "map" })), preview: null });
    refresh();
    return { ok: true, id: made.id };
  } catch (e) {
    return fail(e);
  }
}
