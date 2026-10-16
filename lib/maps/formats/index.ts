import { LIMITS, MAP_VERSION, cleanText, fromOutline, nodeCount, parseDoc, toOutline, IMAGE_FILE, type MapDoc, type Outline } from "../model";
import { isZip, ZipError } from "./unzip";
import { parseFreemind, parseIndented, parseMarkdown, parseMermaid, parseOpml, asTree, toFreemind, toMarkdown, toMermaid, toOpml } from "./outline";
import { parseXmind } from "./xmind";

/**
 * Every way a map comes in, behind one door: a file's name and bytes give
 * maps ready to save, with the images they carry (as data URLs, to upload).
 *
 *   .lifeosmap.json  LifeOS's own format, lossless (style, colours, images)
 *   .xmind           XMind 8 and XMind 2020+, images and markers included
 *   .mm              FreeMind and Freeplane
 *   .opml            any outliner (Workflowy, Dynalist, OmniOutliner…)
 *   .md / .txt       Markdown headings and lists, or an indented outline
 *   .mmd             a Mermaid `mindmap`
 */

export interface ImportedMap {
  title: string;
  doc: MapDoc;
  /** Image file named in the document → data URL, to upload before saving. */
  assets: Record<string, string>;
}

export class ImportError extends Error {
  constructor(public code: "unknown" | "empty" | "damaged" | "too_large", message: string) {
    super(message);
  }
}

export const IMPORT_ACCEPT = ".lifeosmap,.json,.xmind,.mm,.opml,.md,.markdown,.txt,.mmd,.mermaid";
const MAX_FILE = 40 * 1024 * 1024;

export const NATIVE_FORMAT = "lifeos-mind-map";

export interface NativeFile {
  format: typeof NATIVE_FORMAT;
  version: typeof MAP_VERSION;
  title: string;
  exportedAt: string;
  doc: MapDoc;
  assets: Record<string, string>;
}

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

function nativeAssets(doc: MapDoc, raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  const wanted = new Set(Object.values(doc.nodes).flatMap((n) => (n.image ? [n.image.file] : [])));
  for (const [file, url] of Object.entries(raw as Record<string, unknown>)) {
    if (wanted.has(file) && IMAGE_FILE.test(file) && typeof url === "string" && url.length < 12_000_000 && DATA_URL.test(url)) out[file] = url;
  }
  return out;
}

/** Images a document names but the file does not carry are dropped, not left broken. */
function keepCarried(doc: MapDoc, assets: Record<string, string>): MapDoc {
  const nodes = { ...doc.nodes };
  for (const [id, n] of Object.entries(nodes)) {
    if (n.image && !assets[n.image.file]) {
      const { image: _i, ...rest } = n;
      nodes[id] = rest;
    }
  }
  return { ...doc, nodes };
}

const stem = (name: string) => cleanText(name.replace(/\.(lifeosmap\.json|lifeosmap|json|xmind|mm|opml|md|markdown|txt|mmd|mermaid)$/i, ""), 200).trim() || "Map";

export async function importMap(name: string, bytes: Uint8Array): Promise<ImportedMap[]> {
  if (bytes.length > MAX_FILE) throw new ImportError("too_large", "File too large.");
  if (bytes.length === 0) throw new ImportError("empty", "Empty file.");
  const title = stem(name);
  const lower = name.toLowerCase();

  if (lower.endsWith(".xmind") || isZip(bytes)) {
    try {
      const sheets = await parseXmind(bytes);
      if (sheets.length === 0) throw new ImportError("empty", "No map in this file.");
      return sheets.map((s) => {
        const doc = fromOutline(s.outline, s.layout ? { layout: s.layout } : {});
        return { title: s.title || title, doc, assets: s.assets };
      });
    } catch (e) {
      if (e instanceof ImportError) throw e;
      throw new ImportError("damaged", e instanceof ZipError ? e.message : "Unreadable XMind file.");
    }
  }

  const text = new TextDecoder("utf-8").decode(bytes);
  const trimmed = text.trimStart();
  let outline: Outline;
  try {
    if (lower.endsWith(".json") || lower.endsWith(".lifeosmap") || trimmed.startsWith("{")) {
      const data = JSON.parse(text) as Record<string, unknown>;
      const rawDoc = data.format === NATIVE_FORMAT ? data.doc : data;
      const doc = parseDoc(rawDoc);
      if (!doc) throw new ImportError("damaged", "Not a LifeOS map.");
      const assets = nativeAssets(doc, data.assets);
      const docTitle = typeof data.title === "string" ? cleanText(data.title, 200).trim() : "";
      return [{ title: docTitle || doc.nodes[doc.root].text.trim() || title, doc: keepCarried(doc, assets), assets }];
    }
    if (lower.endsWith(".opml") || /<opml[\s>]/i.test(trimmed.slice(0, 500))) outline = parseOpml(text, title);
    else if (lower.endsWith(".mm") || /^(<\?xml[^>]*>\s*)?<map[\s>]/i.test(trimmed)) outline = parseFreemind(text, title);
    else if (lower.endsWith(".mmd") || lower.endsWith(".mermaid") || /^mindmap\s*$/m.test(trimmed.split("\n")[0] ?? "")) outline = parseMermaid(text, title);
    else if (lower.endsWith(".md") || lower.endsWith(".markdown") || /^#{1,6}\s/m.test(text)) outline = parseMarkdown(text, title);
    else outline = asTree(parseIndented(text), title);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("damaged", "Unreadable file.");
  }
  if (!outline.text.trim() && !outline.children?.length) throw new ImportError("empty", "Nothing to import.");
  if (!outline.text.trim()) outline.text = title;
  return [{ title: outline.text, doc: fromOutline(outline), assets: {} }];
}

/* ── Text exports ───────────────────────────────────────────────────── */

export type TextExport = "md" | "opml" | "mm" | "mermaid" | "txt";

export function exportText(doc: MapDoc, format: TextExport, from: string = doc.root): string {
  const o = toOutline(doc, from);
  const title = o.text.trim() || "Map";
  switch (format) {
    case "md":
      return toMarkdown(o);
    case "opml":
      return toOpml(o, title);
    case "mm":
      return toFreemind(o);
    case "mermaid":
      return toMermaid(o);
    case "txt":
      return toIndentedText(o);
  }
}

function toIndentedText(o: Outline, depth = 0): string {
  const line = `${"\t".repeat(depth)}${[o.emoji, o.text.replace(/\n+/g, " ")].filter(Boolean).join(" ")}`;
  return [line, ...(o.children ?? []).map((c) => toIndentedText(c, depth + 1))].join("\n");
}

/** LifeOS's own file: the document as it is, with its images inside. */
export function toNative(doc: MapDoc, title: string, assets: Record<string, string>, now = new Date()): NativeFile {
  return { format: NATIVE_FORMAT, version: MAP_VERSION, title, exportedAt: now.toISOString(), doc, assets };
}

/** A safe file name from a title. */
export function fileStem(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  return s || "carte";
}

export const MAX_NODES = LIMITS.nodes;
export { nodeCount };
