"use client";

import { DEFAULT_STYLE, fromOutline, showLevels, visibleIds, type MapDoc, type MapStyle, type Outline } from "@/lib/maps/model";
import { layoutMap } from "@/lib/maps/layout";
import { toSvg } from "@/lib/maps/svg";
import type { FontFamilies } from "@/lib/maps/theme";
import type { Measurer } from "@/lib/maps/measure";
import { sharedMeasurer } from "./client";

/**
 * Small pictures of a map drawn by the real renderer: a theme's card, a
 * template's card. Text is drawn as soft bars — the shape is what tells
 * them apart at that size.
 */

let n = 0;
const ids = () => `p${++n}`;

const SAMPLE: Outline = {
  text: "Idea",
  children: [
    { text: "First branch", children: [{ text: "One" }, { text: "Two" }] },
    { text: "Second", children: [{ text: "Three" }] },
    { text: "Third branch", children: [{ text: "Four" }, { text: "Five" }] },
    { text: "Fourth", children: [{ text: "Six" }] },
  ],
};

const cache = new Map<string, string>();

/** A data URL of `outline` drawn in `style`. */
export function previewUrl(outline: Outline, style: Partial<MapStyle>, families: FontFamilies, key?: string): string {
  const k = key ? `${key}|${JSON.stringify(style)}|${families.sans}` : "";
  const hit = k ? cache.get(k) : undefined;
  if (hit) return hit;
  const doc = fromOutline(outline, { ...DEFAULT_STYLE, ...style }, ids);
  const svg = toSvg(doc, layoutMap(doc, { families, measurer: sharedMeasurer(), placeholder: " " }), { thumbnail: true, padding: 26 });
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (k) cache.set(k, url);
  return url;
}

export const themePreview = (style: Partial<MapStyle>, families: FontFamilies) => previewUrl(SAMPLE, style, families, "sample");

/**
 * The gallery's picture of a map, stored with it: the shape of the map, light
 * enough to list dozens (a large map is shown to its first levels).
 */
export function mapThumbnail(doc: MapDoc, families: FontFamilies, measurer: Measurer = sharedMeasurer()): string | undefined {
  const make = (d: MapDoc) => toSvg(d, layoutMap(d, { families, measurer, placeholder: " " }), { thumbnail: true, padding: 28 });
  let svg = make(visibleIds(doc).length > 400 ? showLevels(doc, 2) : doc);
  if (svg.length > 190_000) svg = make(showLevels(doc, 1));
  return svg.length > 190_000 ? undefined : svg;
}
