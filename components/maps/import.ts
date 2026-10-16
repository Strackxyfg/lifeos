"use client";

import { createMap } from "@/app/actions/maps";
import { ImportError, importMap, type ImportedMap } from "@/lib/maps/formats";
import { updateNode, type MapDoc } from "@/lib/maps/model";
import type { FontFamilies } from "@/lib/maps/theme";
import { dataUrlToBlob, uploadImage } from "./client";
import { mapThumbnail } from "./preview";

/**
 * A file brought into LifeOS: read in the browser (nothing leaves the device
 * but the maps it holds), its images uploaded one by one, then each map
 * saved. An image that cannot be uploaded is left out, never the map.
 */

export type ImportOutcome = { ok: true; ids: string[] } | { ok: false; reason: ImportError["code"] | "save"; detail?: string };

const MAX_SHEETS = 20;

async function withUploadedImages(map: ImportedMap): Promise<MapDoc> {
  let doc = map.doc;
  const done = new Map<string, { file: string; width: number; height: number } | null>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!node.image) continue;
    const src = node.image.file;
    if (!done.has(src)) {
      const data = map.assets[src];
      let up: { file: string; width: number; height: number } | null = null;
      if (data) {
        try {
          const res = await uploadImage(await dataUrlToBlob(data));
          if (res.ok) up = { file: res.file, width: res.width, height: res.height };
        } catch {
          up = null;
        }
      }
      done.set(src, up);
    }
    const up = done.get(src);
    doc = updateNode(doc, id, { image: up ? { ...up, ...(node.image.alt ? { alt: node.image.alt } : {}) } : undefined });
  }
  return doc;
}

export async function importFile(file: File, families: FontFamilies): Promise<ImportOutcome> {
  let maps: ImportedMap[];
  try {
    maps = await importMap(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, reason: e instanceof ImportError ? e.code : "damaged" };
  }
  const ids: string[] = [];
  for (const map of maps.slice(0, MAX_SHEETS)) {
    const doc = await withUploadedImages(map);
    let preview: string | undefined;
    try {
      preview = mapThumbnail(doc, families);
    } catch {
      preview = undefined;
    }
    const res = await createMap({ doc, preview }).catch(() => null);
    if (!res?.ok) return ids.length ? { ok: true, ids } : { ok: false, reason: "save", detail: res ? res.code : "network" };
    ids.push(res.id);
  }
  return { ok: true, ids };
}
