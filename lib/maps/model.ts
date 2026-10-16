/**
 * A mind map: ideas as a tree, each one a node that can carry a note, a
 * link, an image, an emoji, a colour, and a link to a note of the second
 * brain.
 *
 * Kept flat — every node by id, each listing its children — so an edit
 * copies the one node it changes and the path above it, and undo is a list
 * of documents that share everything they did not change.
 *
 * Pure and isomorphic: the editor runs it, the server runs `parseDoc` on
 * every save. Nothing here trusts its input: a document from the network, a
 * file or another app is rebuilt field by field, and what does not fit the
 * rules is dropped rather than stored.
 */

export const MAP_VERSION = 1;

export const LIMITS = {
  nodes: 3000,
  text: 1000,
  note: 20000,
  url: 2048,
  depth: 48,
  emoji: 16,
  alt: 300,
  /** Pixels: an image's natural size, as uploaded (the client scales it down first). */
  imageSide: 8192,
} as const;

export type ThemeId = "daylight" | "midnight" | "paper" | "ocean" | "forest" | "aurora" | "ink" | "pastel";
export const THEME_IDS: readonly ThemeId[] = ["daylight", "midnight", "paper", "ocean", "forest", "aurora", "ink", "pastel"];

export type LayoutKind = "map" | "right" | "down";
export const LAYOUTS: readonly LayoutKind[] = ["map", "right", "down"];

export type EdgeKind = "curve" | "straight" | "elbow";
export const EDGES: readonly EdgeKind[] = ["curve", "straight", "elbow"];

export type FontKind = "sans" | "serif" | "mono";
export const FONTS: readonly FontKind[] = ["sans", "serif", "mono"];

export type Density = "compact" | "normal" | "airy";
export const DENSITIES: readonly Density[] = ["compact", "normal", "airy"];

export type Backdrop = "plain" | "dots" | "grid";
export const BACKDROPS: readonly Backdrop[] = ["plain", "dots", "grid"];

/** How the whole map looks: a theme and the choices made over it. */
export interface MapStyle {
  theme: ThemeId;
  layout: LayoutKind;
  edge: EdgeKind;
  font: FontKind;
  density: Density;
  backdrop: Backdrop;
  /** Each main branch in its own colour; off, every branch in the theme's accent. */
  rainbow: boolean;
}

export const DEFAULT_STYLE: MapStyle = {
  theme: "daylight",
  layout: "map",
  edge: "curve",
  font: "sans",
  density: "normal",
  backdrop: "dots",
  rainbow: true,
};

/** An uploaded image, by its file in the owner's folder, at its natural size. */
export interface NodeImage {
  file: string;
  width: number;
  height: number;
  alt?: string;
}

export interface MapNode {
  id: string;
  text: string;
  children: string[];
  emoji?: string;
  note?: string;
  link?: string;
  /** A note of the second brain this idea is, or points to. */
  noteId?: string;
  image?: NodeImage;
  /** "#rrggbb": this branch's colour, from here down. */
  color?: string;
  collapsed?: boolean;
  /** For the root's children in the "map" layout: which side they grow on. */
  side?: "left" | "right";
  /** Proposed by the AI and not yet touched by the person. */
  ai?: boolean;
}

export interface MapDoc {
  version: typeof MAP_VERSION;
  root: string;
  nodes: Record<string, MapNode>;
  style: MapStyle;
}

/* ── Ids ────────────────────────────────────────────────────────────── */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A short random id: 12 characters of base 36 (62 bits), unique for any map's life. */
export function nodeId(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i] % 36];
  return out;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

const ID = /^[a-z0-9_-]{1,40}$/i;

/* ── Field rules ────────────────────────────────────────────────────── */

/** Control characters, except tab and newline, never belong in text. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(CONTROL, "").slice(0, max);
}

/** Only web and mail links: a `javascript:` or `data:` link would run or show anything. */
export function cleanUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const raw = v.trim();
  if (!raw || raw.length > LIMITS.url) return undefined;
  // A bare domain ("lifeos.app/x") is a web address.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(raw) ? `https://${raw}` : null;
  if (!candidate) return undefined;
  try {
    const u = new URL(candidate);
    if (u.protocol === "http:" || u.protocol === "https:") return u.hostname ? u.href : undefined;
    if (u.protocol === "mailto:") return u.href;
    return undefined;
  } catch {
    return undefined;
  }
}

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
/** A keycap (1️⃣, #️⃣): a digit, an optional emoji selector, the enclosing keycap. */
const KEYCAP = new RegExp(`^[#*0-9]${String.fromCodePoint(0xfe0f)}?${String.fromCodePoint(0x20e3)}$`, "u");

/** One emoji (a single grapheme that is a pictograph), else nothing. */
export function cleanEmoji(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const raw = v.trim();
  if (!raw || raw.length > LIMITS.emoji || !(PICTOGRAPH.test(raw) || KEYCAP.test(raw))) return undefined;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    const parts = [...new Seg(undefined, { granularity: "grapheme" }).segment(raw)];
    if (parts.length !== 1) return undefined;
  }
  return raw;
}

const COLOR = /^#[0-9a-f]{6}$/i;
export const cleanColor = (v: unknown): string | undefined => (typeof v === "string" && COLOR.test(v) ? v.toLowerCase() : undefined);

/** "<id>.<ext>", the shape every stored image has: nothing that walks out of a folder. */
export const IMAGE_FILE = /^[a-f0-9-]{8,64}\.(webp|png|jpg|gif)$/;

export function cleanImage(v: unknown): NodeImage | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const side = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= LIMITS.imageSide ? Math.round(n) : null);
  const width = side(o.width);
  const height = side(o.height);
  if (typeof o.file !== "string" || !IMAGE_FILE.test(o.file) || !width || !height) return undefined;
  const alt = cleanText(o.alt, LIMITS.alt).trim();
  return { file: o.file, width, height, ...(alt ? { alt } : {}) };
}

const NOTE_ID = /^[a-z0-9_-]{1,64}$/i;

export function cleanStyle(v: unknown): MapStyle {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  return {
    theme: pick(o.theme, THEME_IDS, DEFAULT_STYLE.theme),
    layout: pick(o.layout, LAYOUTS, DEFAULT_STYLE.layout),
    edge: pick(o.edge, EDGES, DEFAULT_STYLE.edge),
    font: pick(o.font, FONTS, DEFAULT_STYLE.font),
    density: pick(o.density, DENSITIES, DEFAULT_STYLE.density),
    backdrop: pick(o.backdrop, BACKDROPS, DEFAULT_STYLE.backdrop),
    rainbow: typeof o.rainbow === "boolean" ? o.rainbow : DEFAULT_STYLE.rainbow,
  };
}

/** A node's own fields, cleaned; `children` is rebuilt by `parseDoc`. */
function cleanNode(id: string, o: Record<string, unknown>): MapNode {
  const node: MapNode = { id, text: cleanText(o.text, LIMITS.text), children: [] };
  const emoji = cleanEmoji(o.emoji);
  if (emoji) node.emoji = emoji;
  const note = cleanText(o.note, LIMITS.note);
  if (note.trim()) node.note = note;
  const link = cleanUrl(o.link);
  if (link) node.link = link;
  if (typeof o.noteId === "string" && NOTE_ID.test(o.noteId)) node.noteId = o.noteId;
  const image = cleanImage(o.image);
  if (image) node.image = image;
  const color = cleanColor(o.color);
  if (color) node.color = color;
  if (o.collapsed === true) node.collapsed = true;
  if (o.side === "left" || o.side === "right") node.side = o.side;
  if (o.ai === true) node.ai = true;
  return node;
}

/**
 * Any value → a valid document, or null when there is no tree to save.
 *
 * The tree is walked from the root: a node is kept the first time it is
 * reached (a second parent, a cycle, an unknown child are dropped), never
 * deeper than LIMITS.depth, never more than LIMITS.nodes in all. What no
 * path reaches is not kept.
 */
export function parseDoc(input: unknown): MapDoc | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (o.version !== MAP_VERSION || typeof o.root !== "string" || !o.nodes || typeof o.nodes !== "object") return null;
  const raw = o.nodes as Record<string, unknown>;
  if (!ID.test(o.root) || !raw[o.root] || typeof raw[o.root] !== "object") return null;

  const nodes: Record<string, MapNode> = {};
  let count = 0;
  const visit = (id: string, depth: number): boolean => {
    const src = raw[id];
    if (!ID.test(id) || nodes[id] || !src || typeof src !== "object" || count >= LIMITS.nodes || depth > LIMITS.depth) return false;
    const node = cleanNode(id, src as Record<string, unknown>);
    nodes[id] = node;
    count++;
    const kids = (src as Record<string, unknown>).children;
    if (Array.isArray(kids)) {
      for (const k of kids) if (typeof k === "string" && visit(k, depth + 1)) node.children.push(k);
    }
    return true;
  };
  visit(o.root, 0);
  // Only the root's children grow on a side.
  for (const n of Object.values(nodes)) if (n.side && !nodes[o.root].children.includes(n.id)) delete n.side;
  delete nodes[o.root].side;
  return { version: MAP_VERSION, root: o.root, nodes, style: cleanStyle(o.style) };
}

/* ── Building ───────────────────────────────────────────────────────── */

export function newDoc(rootText: string, style: Partial<MapStyle> = {}, id: () => string = nodeId): MapDoc {
  const root = id();
  return {
    version: MAP_VERSION,
    root,
    nodes: { [root]: { id: root, text: cleanText(rootText, LIMITS.text), children: [] } },
    style: cleanStyle({ ...DEFAULT_STYLE, ...style }),
  };
}

/** A tree written as nesting, for templates, imports and pasted outlines. */
export interface Outline {
  text: string;
  children?: Outline[];
  emoji?: string;
  note?: string;
  link?: string;
  noteId?: string;
  image?: NodeImage;
  color?: string;
  collapsed?: boolean;
  side?: "left" | "right";
  ai?: boolean;
}

/** A document from an outline, with fresh ids. */
export function fromOutline(outline: Outline, style: Partial<MapStyle> = {}, id: () => string = nodeId): MapDoc {
  const doc = newDoc(outline.text, style, id);
  const rootNode = cleanNode(doc.root, outline as unknown as Record<string, unknown>);
  doc.nodes[doc.root] = { ...rootNode, children: [] };
  const { doc: filled } = insertOutlines(doc, doc.root, outline.children ?? [], undefined, id);
  delete filled.nodes[filled.root].side;
  return filled;
}

/** The tree under `id` (included) as an outline: what copy, export and duplicate use. */
export function toOutline(doc: MapDoc, id: string = doc.root): Outline {
  const n = doc.nodes[id];
  const out: Outline = { text: n.text };
  if (n.emoji) out.emoji = n.emoji;
  if (n.note) out.note = n.note;
  if (n.link) out.link = n.link;
  if (n.noteId) out.noteId = n.noteId;
  if (n.image) out.image = { ...n.image };
  if (n.color) out.color = n.color;
  if (n.collapsed) out.collapsed = true;
  if (n.side) out.side = n.side;
  if (n.ai) out.ai = true;
  if (n.children.length) out.children = n.children.map((c) => toOutline(doc, c));
  return out;
}

/* ── Reading ────────────────────────────────────────────────────────── */

export function parentOf(doc: MapDoc, id: string): string | null {
  for (const n of Object.values(doc.nodes)) if (n.children.includes(id)) return n.id;
  return null;
}

/** Every node's parent, in one pass — what the editor keeps beside the document. */
export function parentIndex(doc: MapDoc): Map<string, string> {
  const parents = new Map<string, string>();
  for (const n of Object.values(doc.nodes)) for (const c of n.children) parents.set(c, n.id);
  return parents;
}

/** From the root to `id`, both included. */
export function pathTo(doc: MapDoc, id: string, parents = parentIndex(doc)): string[] {
  const path = [id];
  let at = parents.get(id);
  while (at) {
    path.unshift(at);
    at = parents.get(at);
  }
  return path;
}

export const depthOf = (doc: MapDoc, id: string, parents = parentIndex(doc)) => pathTo(doc, id, parents).length - 1;

/** `id` and everything under it, depth first. */
export function subtree(doc: MapDoc, id: string): string[] {
  const out: string[] = [];
  const walk = (x: string) => {
    out.push(x);
    for (const c of doc.nodes[x]?.children ?? []) walk(c);
  };
  walk(id);
  return out;
}

export const isInside = (doc: MapDoc, id: string, ancestor: string) => subtree(doc, ancestor).includes(id);

export const nodeCount = (doc: MapDoc) => Object.keys(doc.nodes).length;

/** The nodes on screen: those not hidden under a folded node. */
export function visibleIds(doc: MapDoc): string[] {
  const out: string[] = [];
  const walk = (x: string) => {
    out.push(x);
    const n = doc.nodes[x];
    if (!n.collapsed) for (const c of n.children) walk(c);
  };
  walk(doc.root);
  return out;
}

/** The text a node is known by, for lists, titles and exports. */
export const label = (n: Pick<MapNode, "text" | "emoji">) => [n.emoji, n.text.trim()].filter(Boolean).join(" ");

/** Lower case, without accents: "Été" finds "ete". */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Nodes whose text or note holds every word of the query, in tree order. */
export function search(doc: MapDoc, query: string): string[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return subtree(doc, doc.root).filter((id) => {
    const n = doc.nodes[id];
    const hay = fold(`${n.text}\n${n.note ?? ""}\n${n.link ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/* ── Changing ───────────────────────────────────────────────────────── */
// Every change returns a new document; the nodes it did not touch are shared.

export class MapLimitError extends Error {}

function withNodes(doc: MapDoc, changed: Record<string, MapNode | undefined>): MapDoc {
  const nodes = { ...doc.nodes };
  for (const [id, n] of Object.entries(changed)) {
    if (n) nodes[id] = n;
    else delete nodes[id];
  }
  return { ...doc, nodes };
}

export type NodePatch = Partial<Pick<MapNode, "text" | "emoji" | "note" | "link" | "noteId" | "image" | "color" | "collapsed" | "side">>;

/**
 * Changes a node's fields. `undefined` or "" clears a field. Each value goes
 * through the same rules as a saved document. Touching an AI proposal makes
 * it the person's.
 */
export function updateNode(doc: MapDoc, id: string, patch: NodePatch): MapDoc {
  const n = doc.nodes[id];
  if (!n) return doc;
  const next: MapNode = { ...n };
  const set = <K extends keyof MapNode>(key: K, value: MapNode[K] | undefined) => {
    if (value === undefined || value === "" || value === false) delete next[key];
    else next[key] = value;
  };
  if ("text" in patch) next.text = cleanText(patch.text, LIMITS.text);
  if ("emoji" in patch) set("emoji", cleanEmoji(patch.emoji));
  if ("note" in patch) set("note", cleanText(patch.note, LIMITS.note).trim() ? cleanText(patch.note, LIMITS.note) : undefined);
  if ("link" in patch) set("link", cleanUrl(patch.link));
  if ("noteId" in patch) set("noteId", typeof patch.noteId === "string" && NOTE_ID.test(patch.noteId) ? patch.noteId : undefined);
  if ("image" in patch) set("image", cleanImage(patch.image));
  if ("color" in patch) set("color", cleanColor(patch.color));
  if ("collapsed" in patch) set("collapsed", patch.collapsed === true && n.children.length > 0 ? true : undefined);
  if ("side" in patch) set("side", (patch.side === "left" || patch.side === "right") && doc.nodes[doc.root].children.includes(id) ? patch.side : undefined);
  if (Object.keys(patch).some((k) => k !== "collapsed" && k !== "side")) delete next.ai;
  return withNodes(doc, { [id]: next });
}

export function setStyle(doc: MapDoc, patch: Partial<MapStyle>): MapDoc {
  return { ...doc, style: cleanStyle({ ...doc.style, ...patch }) };
}

/** Adds `outlines` under `parentId` at `index` (the end by default), with fresh ids. */
export function insertOutlines(
  doc: MapDoc,
  parentId: string,
  outlines: Outline[],
  index?: number,
  id: () => string = nodeId
): { doc: MapDoc; ids: string[] } {
  const parent = doc.nodes[parentId];
  if (!parent || outlines.length === 0) return { doc, ids: [] };
  const size = (o: Outline): number => 1 + (o.children ?? []).reduce((s, c) => s + size(c), 0);
  const adding = outlines.reduce((s, o) => s + size(o), 0);
  if (nodeCount(doc) + adding > LIMITS.nodes) throw new MapLimitError(`A map holds at most ${LIMITS.nodes} ideas.`);

  const created: Record<string, MapNode> = {};
  const build = (o: Outline): string => {
    let nid = id();
    // Ids are random; a clash is next to impossible, and still never kept.
    while (doc.nodes[nid] || created[nid]) nid = id();
    const node = cleanNode(nid, o as unknown as Record<string, unknown>);
    delete node.side;
    created[nid] = node;
    node.children = (o.children ?? []).map(build);
    return nid;
  };
  const ids = outlines.map(build);
  const at = index === undefined ? parent.children.length : Math.max(0, Math.min(index, parent.children.length));
  const children = [...parent.children.slice(0, at), ...ids, ...parent.children.slice(at)];
  // Pasted under the root, an outline's sides mean something again.
  if (parentId === doc.root) outlines.forEach((o, i) => {
    if (o.side === "left" || o.side === "right") created[ids[i]].side = o.side;
  });
  // What was added is shown: the parent unfolds.
  const opened: MapNode = { ...parent, children };
  delete opened.collapsed;
  return { doc: withNodes(doc, { ...created, [parentId]: opened }), ids };
}

export function addChild(doc: MapDoc, parentId: string, text = "", id: () => string = nodeId): { doc: MapDoc; id: string } {
  const { doc: next, ids } = insertOutlines(doc, parentId, [{ text }], undefined, id);
  return { doc: unfold(next, parentId), id: ids[0] };
}

const unfold = (doc: MapDoc, id: string): MapDoc => {
  const n = doc.nodes[id];
  if (!n?.collapsed) return doc;
  const { collapsed: _c, ...rest } = n;
  return withNodes(doc, { [id]: rest });
};

/** A sibling just after (or before) `id`; on the root, a child. */
export function addSibling(doc: MapDoc, siblingOf: string, text = "", before = false, id: () => string = nodeId): { doc: MapDoc; id: string } {
  const parent = parentOf(doc, siblingOf);
  if (!parent) return addChild(doc, siblingOf, text, id);
  const at = doc.nodes[parent].children.indexOf(siblingOf) + (before ? 0 : 1);
  const side = doc.nodes[siblingOf].side;
  const { doc: next, ids } = insertOutlines(doc, parent, [{ text, side }], at, id);
  return { doc: next, id: ids[0] };
}

/**
 * Removes nodes and everything under them (never the root). Says which node
 * to select next: the next sibling, else the previous one, else the parent.
 */
export function removeNodes(doc: MapDoc, ids: string[]): { doc: MapDoc; next: string } {
  const parents = parentIndex(doc);
  const targets = ids.filter((i) => i !== doc.root && doc.nodes[i]);
  if (targets.length === 0) return { doc, next: ids[0] ?? doc.root };
  const first = targets[0];
  const parent = parents.get(first) ?? doc.root;
  const siblings = doc.nodes[parent].children;
  const remaining = siblings.filter((c) => !targets.includes(c));
  const pos = siblings.indexOf(first);
  const after = siblings.slice(pos + 1).find((c) => remaining.includes(c));
  const before = [...siblings.slice(0, pos)].reverse().find((c) => remaining.includes(c));

  const gone = new Set(targets.flatMap((t) => subtree(doc, t)));
  const nodes: Record<string, MapNode> = {};
  for (const [nid, n] of Object.entries(doc.nodes)) {
    if (gone.has(nid)) continue;
    const kids = n.children.filter((c) => !gone.has(c));
    if (kids.length === n.children.length) {
      nodes[nid] = n;
      continue;
    }
    const changed: MapNode = { ...n, children: kids };
    // Nothing left under it: nothing to fold.
    if (kids.length === 0) delete changed.collapsed;
    nodes[nid] = changed;
  }
  const next = after ?? before ?? (gone.has(parent) ? doc.root : parent);
  return { doc: { ...doc, nodes }, next };
}

/**
 * Moves a node (with its tree) under `parentId` at `index`. Refused — the
 * document comes back unchanged — for the root, or into its own tree.
 * `index` counts the new parent's children as they are before the move.
 */
export function moveNode(doc: MapDoc, id: string, parentId: string, index: number, side?: "left" | "right"): MapDoc {
  if (id === doc.root || !doc.nodes[id] || !doc.nodes[parentId] || isInside(doc, parentId, id)) return doc;
  const from = parentOf(doc, id)!;
  const fromKids = doc.nodes[from].children;
  let at = Math.max(0, Math.min(index, doc.nodes[parentId].children.length));
  if (from === parentId && fromKids.indexOf(id) < at) at--;
  const changed: Record<string, MapNode> = {};
  changed[from] = { ...doc.nodes[from], children: fromKids.filter((c) => c !== id) };
  const target = changed[parentId] ?? doc.nodes[parentId];
  const kids = [...target.children];
  kids.splice(at, 0, id);
  changed[parentId] = { ...target, children: kids };
  delete changed[parentId].collapsed;
  const moved: MapNode = { ...doc.nodes[id] };
  if (parentId === doc.root && (side === "left" || side === "right")) moved.side = side;
  else if (parentId !== doc.root) delete moved.side;
  changed[id] = moved;
  if (changed[from].children.length === 0) delete changed[from].collapsed;
  return withNodes(doc, changed);
}

/** Tab in an outline: becomes the last child of the sibling above. */
export function indent(doc: MapDoc, id: string): MapDoc {
  const parent = parentOf(doc, id);
  if (!parent) return doc;
  const kids = doc.nodes[parent].children;
  const i = kids.indexOf(id);
  if (i <= 0) return doc;
  const newParent = kids[i - 1];
  return moveNode(unfold(doc, newParent), id, newParent, doc.nodes[newParent].children.length);
}

/** Shift+Tab: becomes the sibling just after its parent. */
export function outdent(doc: MapDoc, id: string): MapDoc {
  const parent = parentOf(doc, id);
  if (!parent || parent === doc.root) return doc;
  const grand = parentOf(doc, parent)!;
  return moveNode(doc, id, grand, doc.nodes[grand].children.indexOf(parent) + 1, doc.nodes[parent].side);
}

/** Up or down among its siblings. */
export function reorder(doc: MapDoc, id: string, delta: -1 | 1): MapDoc {
  const parent = parentOf(doc, id);
  if (!parent) return doc;
  const kids = doc.nodes[parent].children;
  const i = kids.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= kids.length) return doc;
  const next = [...kids];
  [next[i], next[j]] = [next[j], next[i]];
  return withNodes(doc, { [parent]: { ...doc.nodes[parent], children: next } });
}

/** Folds or unfolds several nodes; a node with nothing under it never folds. */
export function setCollapsed(doc: MapDoc, ids: string[], collapsed: boolean): MapDoc {
  const changed: Record<string, MapNode> = {};
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n || n.children.length === 0 || !!n.collapsed === collapsed) continue;
    const next = { ...n };
    if (collapsed) next.collapsed = true;
    else delete next.collapsed;
    changed[id] = next;
  }
  return Object.keys(changed).length ? withNodes(doc, changed) : doc;
}

/** Shows the first `level` levels below the root and folds the rest. */
export function showLevels(doc: MapDoc, level: number): MapDoc {
  const parents = parentIndex(doc);
  const fold: string[] = [];
  const open: string[] = [];
  for (const id of Object.keys(doc.nodes)) {
    if (doc.nodes[id].children.length === 0) continue;
    (depthOf(doc, id, parents) >= level ? fold : open).push(id);
  }
  return setCollapsed(setCollapsed(doc, open, false), fold, true);
}

/** Unfolds every node on the way to `id`, so it can be seen. */
export function reveal(doc: MapDoc, id: string): MapDoc {
  const path = pathTo(doc, id);
  return setCollapsed(doc, path.slice(0, -1), false);
}

/** A copy of a node's tree placed just after it. */
export function duplicate(doc: MapDoc, id: string, ids: () => string = nodeId): { doc: MapDoc; id: string } {
  const parent = parentOf(doc, id);
  if (!parent) return { doc, id };
  const at = doc.nodes[parent].children.indexOf(id) + 1;
  const { doc: next, ids: made } = insertOutlines(doc, parent, [toOutline(doc, id)], at, ids);
  return { doc: next, id: made[0] };
}

/** The AI's proposals under a node, accepted (made the person's) or set aside. */
export function settleProposals(doc: MapDoc, ids: string[], accept: boolean): MapDoc {
  const proposals = ids.filter((i) => doc.nodes[i]?.ai);
  if (accept) {
    const changed: Record<string, MapNode> = {};
    for (const i of proposals) {
      const { ai: _a, ...rest } = doc.nodes[i];
      changed[i] = rest;
    }
    return withNodes(doc, changed);
  }
  return removeNodes(doc, proposals).doc;
}
