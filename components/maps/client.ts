"use client";

import { uploadMapImage, type MapsCode } from "@/app/actions/maps";
import { layoutMap, type Layout } from "@/lib/maps/layout";
import { canvasMeasurer, type Measurer } from "@/lib/maps/measure";
import { FONT_STACK, type FontFamilies } from "@/lib/maps/theme";
import type { MapDoc } from "@/lib/maps/model";
import { toSvg } from "@/lib/maps/svg";
import { paintBounds, paintMap } from "@/lib/maps/paint";
import { jpegToPdf } from "@/lib/maps/pdf";

/**
 * What the map editor does in the browser: measure with the page's fonts,
 * scale images down before they leave the device, and turn a map into a
 * PNG, an SVG (fonts and images inside) or a PDF.
 */

/* ── Fonts ─────────────────────────────────────────────────────────── */

/** The families the page really loaded (Geist under its generated name), each followed by its stack. */
export function pageFamilies(): FontFamilies {
  const probe = (cls: string) => {
    const el = document.createElement("span");
    el.className = cls;
    el.style.position = "absolute";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const family = getComputedStyle(el).fontFamily;
    el.remove();
    return family;
  };
  const first = (stack: string) => stack.split(",")[0]?.trim() ?? "";
  const sans = first(probe("font-sans"));
  const mono = first(probe("font-mono"));
  return {
    sans: sans ? `${sans}, ${FONT_STACK.sans}` : FONT_STACK.sans,
    serif: FONT_STACK.serif,
    mono: mono ? `${mono}, ${FONT_STACK.mono}` : FONT_STACK.mono,
  };
}

let measurer: Measurer | null = null;
export const sharedMeasurer = () => (measurer ??= canvasMeasurer());
/** A new measurer, once the webfonts are in: widths measured in a fallback font are forgotten. */
export function freshMeasurer(): Measurer {
  measurer = canvasMeasurer();
  return measurer;
}

/** A layout for exporting: an empty idea takes no placeholder. */
export function exportLayout(doc: MapDoc, families: FontFamilies): Layout {
  return layoutMap(doc, { families, measurer: sharedMeasurer(), placeholder: " " });
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/**
 * The @font-face rules of the loaded webfonts a map uses, with each font
 * file inlined — so an SVG export shows the same letters anywhere.
 */
export async function embeddedFontCss(families: string[]): Promise<string> {
  const wanted = new Set(families.map((f) => unquote(f.split(",")[0] ?? "")).filter(Boolean));
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = unquote(rule.style.getPropertyValue("font-family"));
      if (!wanted.has(family)) continue;
      const src = rule.style.getPropertyValue("src");
      const url = /url\(["']?([^"')]+)["']?\)/.exec(src)?.[1];
      if (!url) continue;
      try {
        const res = await fetch(new URL(url, sheet.href ?? location.href));
        if (!res.ok) continue;
        const data = await blobToDataUrl(await res.blob());
        const weight = rule.style.getPropertyValue("font-weight") || "100 900";
        const style = rule.style.getPropertyValue("font-style") || "normal";
        rules.push(`@font-face{font-family:"${family}";src:url(${data}) format("woff2");font-weight:${weight};font-style:${style}}`);
      } catch {
        // A font that cannot be fetched: the SVG falls back to the system's.
      }
    }
  }
  return rules.join("");
}

/* ── Images ────────────────────────────────────────────────────────── */

export const imageUrl = (file: string) => `/api/maps/images/${encodeURIComponent(file)}`;

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

const MAX_SIDE = 2048;
const MAX_UPLOAD = 4 * 1024 * 1024;

/**
 * An image as it will be stored: at most 2048 px on its longer side, as
 * WebP where the browser can write it (JPEG, or PNG for a drawing with
 * transparency, where it cannot). An animated GIF small enough is kept as
 * it is, so it keeps moving.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (file.type === "image/gif" && file.size <= MAX_UPLOAD) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s));
    const h = Math.max(1, Math.round(img.naturalHeight * s));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const encode = (type: string, q?: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
    let out = await encode("image/webp", 0.86);
    if (!out || out.type !== "image/webp") out = await encode(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
    for (let q = 0.78; out && out.size > MAX_UPLOAD && q > 0.4; q -= 0.12) out = await encode("image/jpeg", q);
    if (!out) throw new Error("encode");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type UploadResult = { ok: true; file: string; width: number; height: number } | { ok: false; code: MapsCode | "network" };

export async function uploadImage(blob: Blob): Promise<UploadResult> {
  let prepared: Blob;
  try {
    prepared = await prepareImage(blob);
  } catch {
    // The browser could not read it as a picture.
    return { ok: false, code: "invalid" };
  }
  if (prepared.size > MAX_UPLOAD) return { ok: false, code: "too_large" };
  try {
    const form = new FormData();
    form.set("image", prepared, "image");
    const res = await uploadMapImage(form);
    return res.ok ? { ok: true, file: res.file, width: res.width, height: res.height } : { ok: false, code: res.code };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Every image a map shows, as data URLs (for the files that carry their images). */
export async function imageDataUrls(doc: MapDoc, only?: Set<string>): Promise<Map<string, string>> {
  const files = new Set(Object.values(doc.nodes).filter((n) => (!only || only.has(n.id)) && n.image).map((n) => n.image!.file));
  const out = new Map<string, string>();
  await Promise.all(
    [...files].map(async (f) => {
      try {
        const res = await fetch(imageUrl(f));
        if (res.ok) out.set(f, await blobToDataUrl(await res.blob()));
      } catch {
        // A missing image is drawn as an empty frame.
      }
    })
  );
  return out;
}

async function imageElements(doc: MapDoc, only?: Set<string>): Promise<Map<string, HTMLImageElement>> {
  const files = new Set(Object.values(doc.nodes).filter((n) => (!only || only.has(n.id)) && n.image).map((n) => n.image!.file));
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...files].map(async (f) => {
      try {
        out.set(f, await loadImage(imageUrl(f)));
      } catch {
        /* drawn as an empty frame */
      }
    })
  );
  return out;
}

/* ── Exports ───────────────────────────────────────────────────────── */

export interface PictureOptions {
  scale: number;
  background: boolean;
  /** Only these ideas (a branch). */
  only?: Set<string>;
}

/** Browsers refuse canvases past about 16k pixels a side or 268 million pixels. */
const MAX_CANVAS_SIDE = 16000;
const MAX_CANVAS_AREA = 120_000_000;

export class PictureTooLarge extends Error {}

export async function toCanvas(doc: MapDoc, families: FontFamilies, opts: PictureOptions): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const layout = exportLayout(doc, families);
  const pad = 48;
  const b = paintBounds(layout, opts.only);
  const w = Math.ceil((b.w + pad * 2) * opts.scale);
  const h = Math.ceil((b.h + pad * 2) * opts.scale);
  if (w > MAX_CANVAS_SIDE || h > MAX_CANVAS_SIDE || w * h > MAX_CANVAS_AREA) throw new PictureTooLarge();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PictureTooLarge();
  paintMap(ctx, doc, layout, { scale: opts.scale, padding: pad, background: opts.background, images: await imageElements(doc, opts.only), only: opts.only });
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), type, q));

export async function exportPng(doc: MapDoc, families: FontFamilies, opts: PictureOptions): Promise<Blob> {
  return toBlob(await toCanvas(doc, families, opts), "image/png");
}

export async function exportPdf(doc: MapDoc, families: FontFamilies, title: string, opts: Omit<PictureOptions, "background">): Promise<Blob> {
  // JPEG has no transparency: a PDF always has the theme's background.
  const canvas = await toCanvas(doc, families, { ...opts, background: true });
  const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
  return new Blob([jpegToPdf(jpeg, canvas.width, canvas.height, title) as BlobPart], { type: "application/pdf" });
}

export async function exportSvg(doc: MapDoc, families: FontFamilies, title: string, opts: Omit<PictureOptions, "scale">): Promise<string> {
  await document.fonts?.ready;
  const layout = exportLayout(doc, families);
  const [images, fontCss] = await Promise.all([imageDataUrls(doc, opts.only), embeddedFontCss([families[doc.style.font]])]);
  return toSvg(doc, layout, { padding: 48, background: opts.background, images, fontCss, only: opts.only, title });
}

export function download(data: Blob | string, filename: string, type = "application/octet-stream") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Copies a picture. Called synchronously in the click: Safari only allows a
 * clipboard write started in the gesture, so the image is passed as a
 * promise and the item is built at once.
 */
export async function copyPng(blob: Promise<Blob>): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
