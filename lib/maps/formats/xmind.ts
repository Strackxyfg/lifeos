import { LIMITS, cleanEmoji, cleanText, cleanUrl, type LayoutKind, type Outline } from "../model";
import { ZipWriter } from "@/lib/export/zip";
import { readZip, ZipError } from "./unzip";
import { child, elements, escapeXml, parseXml, textOf, type XmlElement } from "./xml";

/**
 * XMind files (.xmind): a ZIP with the map as JSON (XMind 2020 and later,
 * `content.json`) or as XML (XMind 8, `content.xml`). Both are read; both
 * are written, so the file opens in either generation. Images travel inside,
 * under `resources/`; markers that have an obvious emoji become one.
 */

export interface XmindSheet {
  title: string;
  outline: Outline;
  layout?: LayoutKind;
  /** Temporary image file name → data URL. */
  assets: Record<string, string>;
}

const MARKERS: Record<string, string> = {
  "priority-1": "1️⃣",
  "priority-2": "2️⃣",
  "priority-3": "3️⃣",
  "priority-4": "4️⃣",
  "priority-5": "5️⃣",
  "priority-6": "6️⃣",
  "priority-7": "7️⃣",
  "priority-8": "8️⃣",
  "priority-9": "9️⃣",
  "task-done": "✅",
  "task-start": "⬜",
  "task-oct": "🕐",
  "task-quarter": "🕒",
  "task-half": "🕕",
  "task-3quar": "🕘",
  "flag-red": "🚩",
  "flag-orange": "🚩",
  "flag-green": "🚩",
  "flag-blue": "🚩",
  "flag-purple": "🚩",
  "flag-gray": "🏳️",
  "star-red": "⭐",
  "star-orange": "⭐",
  "star-yellow": "⭐",
  "star-green": "⭐",
  "star-blue": "⭐",
  "star-purple": "⭐",
  "symbol-question": "❓",
  "symbol-exclam": "❗",
  "symbol-info": "ℹ️",
  "symbol-wrong": "❌",
  "symbol-right": "✔️",
  "symbol-plus": "➕",
  "symbol-minus": "➖",
  "symbol-attention": "⚠️",
  "symbol-idea": "💡",
  "smiley-smile": "🙂",
  "smiley-laugh": "😄",
  "smiley-angry": "😠",
  "smiley-cry": "😢",
  "smiley-surprise": "😮",
  "smiley-boring": "😐",
  "people-red": "👤",
  "people-blue": "👤",
  "month-jan": "📅",
  "arrow-right": "➡️",
  "arrow-left": "⬅️",
  "arrow-up": "⬆️",
  "arrow-down": "⬇️",
  "c_symbol_heart": "❤️",
  "c_symbol_like": "👍",
  "c_symbol_dislike": "👎",
  "c_symbol_money": "💰",
  "c_symbol_trophy": "🏆",
  "c_symbol_pen": "✏️",
  "c_symbol_telephone": "📞",
  "c_symbol_email": "✉️",
  "c_symbol_contact": "📇",
};

const markerEmoji = (ids: string[]) => cleanEmoji(ids.map((id) => MARKERS[id]).find(Boolean));

const structureLayout = (s: unknown): LayoutKind | undefined => {
  if (typeof s !== "string") return undefined;
  if (/logic\.right|tree\.right|timeline/i.test(s)) return "right";
  if (/org-?chart|tree\.down|org\.down/i.test(s)) return "down";
  if (/\.map/i.test(s)) return "map";
  return undefined;
};

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function tempFile(ext: string): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return `${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}.${ext === "jpeg" ? "jpg" : ext}`;
}

export async function parseXmind(bytes: Uint8Array): Promise<XmindSheet[]> {
  const zip = await readZip(bytes);
  const assets: Record<string, string> = {};
  let budget = LIMITS.nodes;

  /** A resource of the archive ("xap:resources/x.png") as an image asset, if it is one. */
  const image = async (src: unknown, width?: unknown, height?: unknown) => {
    if (typeof src !== "string") return undefined;
    const path = src.replace(/^xap:/, "");
    const entry = zip.get(path);
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
    if (!entry || !MIME[ext]) return undefined;
    const data = await entry.read();
    if (data.length > 8 * 1024 * 1024) return undefined;
    const file = tempFile(ext);
    assets[file] = `data:${MIME[ext]};base64,${base64(data)}`;
    const dim = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v) : 400);
    return { file, width: dim(width), height: dim(height) };
  };

  const json = zip.get("content.json");
  if (json) {
    const sheets = JSON.parse(new TextDecoder().decode(await json.read())) as unknown;
    if (!Array.isArray(sheets)) throw new ZipError("Unreadable XMind file.");
    const out: XmindSheet[] = [];
    for (const sheet of sheets.slice(0, 20)) {
      const s = sheet as Record<string, unknown>;
      const topic = async (t: Record<string, unknown>): Promise<Outline | null> => {
        if (budget-- <= 0) return null;
        const node: Outline = { text: cleanText(t.title, LIMITS.text).trim() };
        const notes = (t.notes as { plain?: { content?: unknown } } | undefined)?.plain?.content;
        const note = cleanText(notes, LIMITS.note).trim();
        if (note) node.note = note;
        const href = cleanUrl(t.href);
        if (href) node.link = href;
        const markers = Array.isArray(t.markers) ? t.markers.map((mk) => String((mk as { markerId?: unknown }).markerId ?? "")) : [];
        const emoji = markerEmoji(markers);
        if (emoji) node.emoji = emoji;
        const img = t.image as { src?: unknown; width?: unknown; height?: unknown } | undefined;
        if (img) {
          const made = await image(img.src, img.width, img.height);
          if (made) node.image = made;
        }
        if (t.branch === "folded") node.collapsed = true;
        const kids = ((t.children as { attached?: unknown[] } | undefined)?.attached ?? []) as Record<string, unknown>[];
        const children: Outline[] = [];
        for (const k of kids) {
          const c = await topic(k);
          if (c) children.push(c);
        }
        if (children.length) node.children = children;
        else delete node.collapsed;
        return node;
      };
      const root = s.rootTopic as Record<string, unknown> | undefined;
      if (!root) continue;
      const outline = await topic(root);
      if (!outline) continue;
      out.push({ title: cleanText(s.title, 200).trim() || outline.text, outline, layout: structureLayout(root.structureClass), assets });
    }
    return out;
  }

  const xml = zip.get("content.xml");
  if (!xml) throw new ZipError("No map in this XMind file.");
  const doc = parseXml(new TextDecoder().decode(await xml.read()));
  const out: XmindSheet[] = [];
  for (const sheet of elements(doc, "sheet").slice(0, 20)) {
    const topicEl = child(sheet, "topic");
    if (!topicEl) continue;
    const topic = async (t: XmlElement): Promise<Outline | null> => {
      if (budget-- <= 0) return null;
      const node: Outline = { text: cleanText(textOf(child(t, "title") ?? ""), LIMITS.text).trim() };
      const plain = child(child(t, "notes") ?? t, "plain");
      const note = plain ? cleanText(textOf(plain), LIMITS.note).trim() : "";
      if (note) node.note = note;
      const href = cleanUrl(t.attrs["xlink:href"]);
      if (href) node.link = href;
      const markers = elements(child(t, "marker-refs") ?? t, "marker-ref").map((m) => m.attrs["marker-id"] ?? "");
      const emoji = markerEmoji(markers);
      if (emoji) node.emoji = emoji;
      const img = elements(t, "img")[0];
      if (img) {
        const made = await image(img.attrs["xhtml:src"] ?? img.attrs.src, Number(img.attrs["svg:width"]) || undefined, Number(img.attrs["svg:height"]) || undefined);
        if (made) node.image = made;
      }
      if (t.attrs.branch === "folded") node.collapsed = true;
      const children: Outline[] = [];
      for (const group of elements(child(t, "children") ?? t, "topics")) {
        if ((group.attrs.type ?? "attached") !== "attached") continue;
        for (const k of elements(group, "topic")) {
          const c = await topic(k);
          if (c) children.push(c);
        }
      }
      if (children.length) node.children = children;
      else delete node.collapsed;
      return node;
    };
    const outline = await topic(topicEl);
    if (!outline) continue;
    out.push({ title: cleanText(textOf(child(sheet, "title") ?? ""), 200).trim() || outline.text, outline, layout: structureLayout(topicEl.attrs["structure-class"]), assets });
  }
  return out;
}

/* ── Writing ────────────────────────────────────────────────────────── */

export interface XmindImage {
  bytes: Uint8Array;
  ext: string;
}

const STRUCTURE: Record<LayoutKind, string> = {
  map: "org.xmind.ui.map.clockwise",
  right: "org.xmind.ui.logic.right",
  down: "org.xmind.ui.org-chart.down",
};

/** An .xmind file (both generations' content), images included. */
export async function toXmind(o: Outline, title: string, layout: LayoutKind, loadImage: (file: string) => Promise<XmindImage | null>): Promise<Uint8Array> {
  let n = 0;
  const id = () => `lifeos-${(++n).toString(36)}`;
  const resources = new Map<string, Uint8Array>();
  const imageFor = async (x: Outline) => {
    if (!x.image) return null;
    const img = await loadImage(x.image.file);
    if (!img) return null;
    const name = `resources/${x.image.file.replace(/\.[a-z]+$/, "")}.${img.ext}`;
    resources.set(name, img.bytes);
    const s = Math.min(1, 220 / x.image.width, 160 / x.image.height);
    return { src: `xap:${name}`, width: Math.round(x.image.width * s), height: Math.round(x.image.height * s) };
  };

  type Topic = Record<string, unknown>;
  const jsonTopic = async (x: Outline, depth: number): Promise<Topic> => {
    const t: Topic = { id: id(), class: "topic", title: [x.emoji, x.text].filter(Boolean).join(" ") };
    if (depth === 0) t.structureClass = STRUCTURE[layout];
    if (x.note?.trim()) t.notes = { plain: { content: x.note } };
    if (x.link) t.href = x.link;
    if (x.collapsed && x.children?.length) t.branch = "folded";
    const img = await imageFor(x);
    if (img) t.image = img;
    if (x.children?.length) t.children = { attached: await Promise.all(x.children.map((c) => jsonTopic(c, depth + 1))) };
    return t;
  };
  const rootTopic = await jsonTopic(o, 0);
  const content = [{ id: "lifeos-sheet", class: "sheet", title, rootTopic, topicPositioning: "fixed" }];

  const xmlTopic = (t: Topic): string => {
    const attrs = [`id="${t.id}"`];
    if (t.structureClass) attrs.push(`structure-class="${t.structureClass}"`);
    if (t.branch) attrs.push(`branch="folded"`);
    if (t.href) attrs.push(`xlink:href="${escapeXml(String(t.href))}"`);
    const kids = (t.children as { attached?: Topic[] } | undefined)?.attached ?? [];
    const note = (t.notes as { plain?: { content?: string } } | undefined)?.plain?.content;
    const img = t.image as { src: string; width: number; height: number } | undefined;
    return (
      `<topic ${attrs.join(" ")}><title>${escapeXml(String(t.title))}</title>` +
      (img ? `<xhtml:img xhtml:src="${escapeXml(img.src)}" svg:width="${img.width}" svg:height="${img.height}"/>` : "") +
      (note ? `<notes><plain>${escapeXml(note)}</plain></notes>` : "") +
      (kids.length ? `<children><topics type="attached">${kids.map(xmlTopic).join("")}</topics></children>` : "") +
      `</topic>`
    );
  };
  const contentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` +
    `<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0">` +
    `<sheet id="lifeos-sheet">${xmlTopic(rootTopic)}<title>${escapeXml(title)}</title></sheet></xmap-content>`;

  const enc = new TextEncoder();
  const files: [string, Uint8Array][] = [
    ["content.json", enc.encode(JSON.stringify(content))],
    ["content.xml", enc.encode(contentXml)],
    ["metadata.json", enc.encode(JSON.stringify({ creator: { name: "LifeOS", version: "1" } }))],
    ["manifest.json", enc.encode(JSON.stringify({ "file-entries": Object.fromEntries([["content.json", {}], ["metadata.json", {}], ...[...resources.keys()].map((k) => [k, {}])]) }))],
    [
      "META-INF/manifest.xml",
      enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="no"?><manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0"><file-entry full-path="content.xml" media-type="text/xml"/><file-entry full-path="META-INF/" media-type=""/><file-entry full-path="META-INF/manifest.xml" media-type="text/xml"/>${[...resources.keys()]
          .map((k) => `<file-entry full-path="${k}" media-type="${MIME[k.split(".").pop()!] ?? "image/png"}"/>`)
          .join("")}</manifest>`
      ),
    ],
    ...resources,
  ];
  const zip = new ZipWriter();
  const parts: Uint8Array[] = [];
  for (const [name, data] of files) parts.push(...zip.file(name, data));
  parts.push(zip.finish());
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
