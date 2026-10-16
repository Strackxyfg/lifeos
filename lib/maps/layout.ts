import type { MapDoc, MapNode } from "./model";
import { branchColor, edgeWidthFor, lookFor, spacingOf, themeOf, type FontFamilies, type NodeLook, type Theme } from "./theme";
import { fontString, wrap, type Measurer } from "./measure";

/**
 * Where every idea goes. The tree is laid out in bands: each node's subtree
 * takes a band as tall as its children's bands stacked (or as itself, if
 * taller), and the node sits in the middle of its band — so no two branches
 * ever cross or overlap, whatever the sizes of the nodes in them.
 *
 *  - "map": the root in the middle, its branches split between the right and
 *    the left so the two sides weigh about the same (in order: the first
 *    branches on the right, the rest on the left, each side top to bottom);
 *    a branch can be sent to one side for good (`side`).
 *  - "right": a logic chart, everything grows to the right.
 *  - "down": an organisation chart, everything grows downward.
 *
 * Pure: the same document, theme and measurer give the same layout.
 */

export type Direction = "right" | "left" | "down";

export interface IconSlot {
  kind: "note" | "link" | "brain";
  x: number;
  y: number;
  size: number;
}

export interface Box {
  id: string;
  /** Top left, in map space. */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Which way its children grow (the root of a "map" grows both ways). */
  dir: Direction | "both";
  look: NodeLook;
  font: string;
  lines: string[];
  /** Where things sit inside the box, from its top left. */
  text: { x: number; y: number; w: number; h: number };
  emoji?: { x: number; y: number; size: number; char: string };
  image?: { x: number; y: number; w: number; h: number; file: string; alt?: string };
  /** The text was empty: `lines` hold the placeholder, drawn quieter. */
  empty: boolean;
  icons: IconSlot[];
  /** Ideas folded away under it (0 when open). */
  hidden: number;
  /** Where its branch leaves it, and where a parent's branch reaches it. */
  out: { x: number; y: number };
  in: { x: number; y: number };
  /** The folded badge's centre, when something is folded under it. */
  badge?: { x: number; y: number };
}

export interface Edge {
  from: string;
  to: string;
  /** An SVG path. */
  d: string;
  color: string;
  width: number;
  /** A filled shape (a tapering branch) rather than a stroke. */
  filled: boolean;
}

export interface Layout {
  boxes: Map<string, Box>;
  /** Visible nodes, parents before children. */
  order: string[];
  edges: Edge[];
  bounds: { x: number; y: number; w: number; h: number };
  theme: Theme;
}

const EMOJI_GAP = 6;
const ICON = 14;
const ICON_GAP = 5;
const IMAGE_GAP = 8;
const BADGE = 10;

/** A node's look and size, with everything placed inside it. */
function measureNode(node: MapNode, depth: number, look: NodeLook, m: Measurer, placeholder: string): Omit<Box, "x" | "y" | "dir" | "hidden" | "out" | "in"> {
  const font = fontString(look.fontWeight, look.fontSize, look.fontFamily);
  const emojiSize = node.emoji ? Math.round(look.fontSize * 1.15) : 0;
  const kinds: IconSlot["kind"][] = [];
  if (node.note) kinds.push("note");
  if (node.link) kinds.push("link");
  if (node.noteId) kinds.push("brain");
  const iconsW = kinds.length ? kinds.length * ICON + (kinds.length - 1) * ICON_GAP + ICON_GAP + 2 : 0;
  const emojiW = emojiSize ? emojiSize + EMOJI_GAP : 0;
  const maxText = Math.max(60, look.maxTextWidth - emojiW - iconsW);
  const shown = node.text.trim() ? node.text : placeholder;
  const lines = wrap(shown, font, maxText, m);
  const textW = Math.max(depth === 0 ? 40 : 12, ...lines.map((l) => m.width(l, font)));
  const textH = lines.length * look.lineHeight;

  let image: Box["image"];
  let imageH = 0;
  if (node.image) {
    const s = Math.min(1, look.imageMax.width / node.image.width, look.imageMax.height / node.image.height);
    const w = Math.max(16, Math.round(node.image.width * s));
    const h = Math.max(16, Math.round(node.image.height * s));
    image = { x: 0, y: look.padY, w, h, file: node.image.file, ...(node.image.alt ? { alt: node.image.alt } : {}) };
    imageH = h + IMAGE_GAP;
  }

  const rowW = emojiW + textW + iconsW;
  const contentW = Math.max(image?.w ?? 0, rowW);
  const rowH = Math.max(textH, emojiSize ? look.lineHeight : 0);
  const w = Math.ceil(contentW + look.padX * 2);
  const h = Math.ceil(imageH + rowH + look.padY * 2);

  // Centred row on a card; flush left on an underline (it reads like a list).
  const centred = look.shape === "card" || look.shape === "pill";
  const rowX = centred ? (w - rowW) / 2 : look.padX;
  const rowY = look.padY + imageH;
  if (image) image.x = Math.round(centred ? (w - image.w) / 2 : look.padX);
  const emoji = emojiSize && node.emoji ? { x: rowX, y: rowY + (look.lineHeight - emojiSize) / 2 - 1, size: emojiSize, char: node.emoji } : undefined;
  const text = { x: rowX + emojiW, y: rowY, w: textW, h: textH };
  const icons = kinds.map((kind, i) => ({
    kind,
    x: text.x + textW + ICON_GAP + 2 + i * (ICON + ICON_GAP),
    y: rowY + (look.lineHeight - ICON) / 2,
    size: ICON,
  }));
  return { id: node.id, w, h, depth, look, font, lines, text, emoji, image, icons, empty: !node.text.trim() };
}

export interface LayoutOptions {
  families: FontFamilies;
  measurer: Measurer;
  /** Shown in an empty node (and measured, so it fits). */
  placeholder?: string;
}

export function layoutMap(doc: MapDoc, opts: LayoutOptions): Layout {
  const theme = themeOf(doc.style);
  const style = doc.style;
  const space = spacingOf(style);
  const placeholder = opts.placeholder ?? " ";
  const boxes = new Map<string, Box>();
  const order: string[] = [];
  const edges: Edge[] = [];
  const root = doc.nodes[doc.root];

  // Branch colours: each main branch its own, inherited unless a node sets one.
  const branch = new Map<string, string>();
  const colorWalk = (id: string, color: string) => {
    const n = doc.nodes[id];
    const c = n.color ?? color;
    branch.set(id, c);
    for (const k of n.children) colorWalk(k, c);
  };
  branch.set(root.id, root.color ?? theme.accent);
  root.children.forEach((k, i) => colorWalk(k, branchColor(theme, style, i)));

  const hiddenCount = (id: string): number => doc.nodes[id].children.reduce((s, c) => s + 1 + hiddenCount(c), 0);
  const visibleKids = (n: MapNode) => (n.collapsed ? [] : n.children);

  // Measured once per node.
  const sized = new Map<string, ReturnType<typeof measureNode>>();
  const sizeOf = (id: string, depth: number) => {
    let s = sized.get(id);
    if (!s) {
      const look = lookFor(theme, style, opts.families, depth, branch.get(id) ?? theme.accent);
      s = measureNode(doc.nodes[id], depth, look, opts.measurer, depth === 0 ? placeholder : placeholder);
      sized.set(id, s);
    }
    return s;
  };

  const rankGap = (depth: number) => (depth === 0 ? space.rank * 1.25 : space.rank);
  const siblingGap = (depth: number) => space.sibling * (depth <= 1 ? 1.6 : 1);

  // The band a subtree needs across its growth: height for sideways, width for down.
  const band = new Map<string, number>();
  const extent = (id: string, depth: number, vertical: boolean): number => {
    const s = sizeOf(id, depth);
    const self = vertical ? s.w : s.h;
    const kids = visibleKids(doc.nodes[id]);
    if (kids.length === 0) {
      band.set(id, self);
      return self;
    }
    const gap = siblingGap(depth + 1);
    const sum = kids.reduce((t, k) => t + extent(k, depth + 1, vertical), 0) + gap * (kids.length - 1);
    const total = Math.max(self, sum);
    band.set(id, total);
    return total;
  };

  const anchorY = (b: { y: number; h: number; look: NodeLook }) => (b.look.shape === "underline" ? b.y + b.h : b.y + b.h / 2);

  const finish = (id: string, depth: number, x: number, y: number, dir: Box["dir"]) => {
    const s = sizeOf(id, depth);
    const n = doc.nodes[id];
    const hidden = n.collapsed ? hiddenCount(id) : 0;
    const box: Box = { ...s, x, y, dir, hidden, out: { x, y }, in: { x, y } };
    const ay = anchorY(box);
    if (dir === "down") {
      box.out = { x: x + s.w / 2, y: y + s.h };
      box.in = { x: x + s.w / 2, y };
      if (hidden) box.badge = { x: x + s.w / 2, y: y + s.h + BADGE + 2 };
    } else if (dir === "left") {
      box.out = { x, y: ay };
      box.in = { x: x + s.w, y: ay };
      if (hidden) box.badge = { x: x - BADGE - 2, y: ay };
    } else {
      box.out = { x: x + s.w, y: ay };
      box.in = { x, y: ay };
      if (hidden) box.badge = { x: x + s.w + BADGE + 2, y: ay };
    }
    boxes.set(id, box);
    return box;
  };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  /**
   * Sideways: `edgeX` is the side the subtree grows from (left edge going
   * right, right edge going left). The children are placed first; the node
   * then sits midway between its first and last child — centred on what
   * hangs from it, not on its whole subtree — kept inside its own band, so
   * it can never meet a neighbour.
   */
  const placeSide = (id: string, depth: number, edgeX: number, top: number, dir: "right" | "left"): Box => {
    const s = sizeOf(id, depth);
    const total = band.get(id)!;
    const x = dir === "right" ? edgeX : edgeX - s.w;
    const kids = visibleKids(doc.nodes[id]);
    if (kids.length === 0) return finish(id, depth, x, top + (total - s.h) / 2, dir);
    const gap = siblingGap(depth + 1);
    const sum = kids.reduce((t, k) => t + band.get(k)!, 0) + gap * (kids.length - 1);
    let y = top + (total - sum) / 2;
    const next = dir === "right" ? x + s.w + rankGap(depth) : x - rankGap(depth);
    const placed = kids.map((k) => {
      const b = placeSide(k, depth + 1, next, y, dir);
      y += band.get(k)! + gap;
      return b;
    });
    const mid = (placed[0].y + placed[0].h / 2 + placed[placed.length - 1].y + placed[placed.length - 1].h / 2) / 2;
    return finish(id, depth, x, clamp(mid - s.h / 2, top, top + total - s.h), dir);
  };

  /** Downward, the same way across. */
  const placeDown = (id: string, depth: number, left: number, y: number): Box => {
    const s = sizeOf(id, depth);
    const total = band.get(id)!;
    const kids = visibleKids(doc.nodes[id]);
    if (kids.length === 0) return finish(id, depth, left + (total - s.w) / 2, y, "down");
    const gap = siblingGap(depth + 1);
    const sum = kids.reduce((t, k) => t + band.get(k)!, 0) + gap * (kids.length - 1);
    let at = left + (total - sum) / 2;
    const placed = kids.map((k) => {
      const b = placeDown(k, depth + 1, at, y + s.h + rankGap(depth));
      at += band.get(k)! + gap;
      return b;
    });
    const mid = (placed[0].x + placed[0].w / 2 + placed[placed.length - 1].x + placed[placed.length - 1].w / 2) / 2;
    return finish(id, depth, clamp(mid - s.w / 2, left, left + total - s.w), y, "down");
  };

  const rootSize = sizeOf(root.id, 0);
  if (style.layout === "down") {
    const total = extent(root.id, 0, true);
    placeDown(root.id, 0, -total / 2, -rootSize.h / 2);
  } else if (style.layout === "right") {
    const total = extent(root.id, 0, false);
    placeSide(root.id, 0, -rootSize.w / 2, -total / 2, "right");
  } else {
    // Both ways from the middle: split the branches so the sides weigh the same.
    const kids = visibleKids(root);
    for (const k of kids) extent(k, 1, false);
    const { right, left } = splitSides(doc, kids, (k) => band.get(k)!);
    const rootBox = finish(root.id, 0, -rootSize.w / 2, -rootSize.h / 2, "both");
    const side = (list: string[], dir: "right" | "left") => {
      const gap = siblingGap(1);
      const sum = list.reduce((t, k) => t + band.get(k)!, 0) + gap * Math.max(0, list.length - 1);
      let y = -sum / 2;
      for (const k of list) {
        placeSide(k, 1, dir === "right" ? rootBox.x + rootBox.w + rankGap(0) : rootBox.x - rankGap(0), y, dir);
        y += band.get(k)! + gap;
      }
    };
    side(right, "right");
    side(left, "left");
    if (root.collapsed) rootBox.badge = { x: rootBox.x + rootBox.w + BADGE + 2, y: rootBox.y + rootBox.h / 2 };
  }

  // Parents before children: the order nodes are drawn and walked in.
  const walk = (id: string) => {
    order.push(id);
    for (const k of visibleKids(doc.nodes[id])) walk(k);
  };
  walk(root.id);

  // Branches: from where the parent's leaves to where the child's arrives.
  for (const id of order) {
    const p = boxes.get(id)!;
    for (const k of visibleKids(doc.nodes[id])) {
      const c = boxes.get(k);
      if (!c) continue;
      const from = p.dir === "both" ? { x: c.dir === "left" ? p.x : p.x + p.w, y: p.y + p.h / 2 } : p.out;
      const color = branch.get(k) ?? theme.accent;
      edges.push({ from: id, to: k, ...edgePath(from, c.in, c.dir === "down", style.edge, edgeWidthFor(theme, c.depth), c.depth === 1), color });
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x, b.badge ? b.badge.x - BADGE : Infinity);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w, b.badge ? b.badge.x + BADGE : -Infinity);
    maxY = Math.max(maxY, b.y + b.h, b.badge ? b.badge.y + BADGE : -Infinity);
  }
  return { boxes, order, edges, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, theme };
}

/**
 * The root's branches, split between the right and the left. A branch sent
 * to a side stays there; the others keep their order — the first ones on
 * the right — at the cut that leaves the two sides closest in height.
 */
export function splitSides(doc: MapDoc, kids: string[], weight: (id: string) => number): { right: string[]; left: string[] } {
  const free = kids.filter((k) => !doc.nodes[k].side);
  const fixedRight = kids.filter((k) => doc.nodes[k].side === "right");
  const fixedLeft = kids.filter((k) => doc.nodes[k].side === "left");
  const base = fixedRight.reduce((s, k) => s + weight(k), 0) - fixedLeft.reduce((s, k) => s + weight(k), 0);
  const total = free.reduce((s, k) => s + weight(k), 0);
  let best = free.length;
  let bestDiff = Infinity;
  let prefix = 0;
  for (let cut = 0; cut <= free.length; cut++) {
    // Right = fixed right + free[0..cut); left = fixed left + the rest.
    const diff = Math.abs(base + prefix - (total - prefix));
    // Ties go to the cut with more on the right, so one branch alone grows right.
    if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) < 1e-9 && cut > best)) {
      bestDiff = diff;
      best = cut;
    }
    if (cut < free.length) prefix += weight(free[cut]);
  }
  const rightSet = new Set([...fixedRight, ...free.slice(0, best)]);
  return { right: kids.filter((k) => rightSet.has(k)), left: kids.filter((k) => !rightSet.has(k)) };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The path of one branch; a main branch on a curve tapers from the root. */
export function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  vertical: boolean,
  kind: "curve" | "straight" | "elbow",
  width: number,
  main: boolean
): { d: string; width: number; filled: boolean } {
  const { x: x1, y: y1 } = from;
  const { x: x2, y: y2 } = to;
  if (kind === "straight") return { d: `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`, width, filled: false };
  if (kind === "elbow") {
    if (vertical) {
      const my = (y1 + y2) / 2;
      const dx = x2 - x1;
      const r = Math.min(10, Math.abs(dx) / 2, Math.abs(y2 - y1) / 2);
      if (Math.abs(dx) < 0.5) return { d: `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`, width, filled: false };
      const sx = Math.sign(dx);
      return {
        d: `M${r1(x1)},${r1(y1)}V${r1(my - r)}Q${r1(x1)},${r1(my)} ${r1(x1 + sx * r)},${r1(my)}H${r1(x2 - sx * r)}Q${r1(x2)},${r1(my)} ${r1(x2)},${r1(my + r)}V${r1(y2)}`,
        width,
        filled: false,
      };
    }
    const mx = (x1 + x2) / 2;
    const dy = y2 - y1;
    const r = Math.min(10, Math.abs(dy) / 2, Math.abs(x2 - x1) / 2);
    if (Math.abs(dy) < 0.5) return { d: `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`, width, filled: false };
    const sy = Math.sign(dy);
    const sx = Math.sign(x2 - x1) || 1;
    return {
      d: `M${r1(x1)},${r1(y1)}H${r1(mx - sx * r)}Q${r1(mx)},${r1(y1)} ${r1(mx)},${r1(y1 + sy * r)}V${r1(y2 - sy * r)}Q${r1(mx)},${r1(y2)} ${r1(mx + sx * r)},${r1(y2)}H${r1(x2)}`,
      width,
      filled: false,
    };
  }
  // A curve leaving and arriving level (or plumb, going down).
  if (vertical) {
    const k = (y2 - y1) * 0.5;
    if (!main) return { d: `M${r1(x1)},${r1(y1)}C${r1(x1)},${r1(y1 + k)} ${r1(x2)},${r1(y2 - k)} ${r1(x2)},${r1(y2)}`, width, filled: false };
    const a = width / 2;
    const b = Math.max(0.8, width * 0.22);
    return {
      d:
        `M${r1(x1 - a)},${r1(y1)}C${r1(x1 - a)},${r1(y1 + k)} ${r1(x2 - b)},${r1(y2 - k)} ${r1(x2 - b)},${r1(y2)}` +
        `L${r1(x2 + b)},${r1(y2)}C${r1(x2 + b)},${r1(y2 - k)} ${r1(x1 + a)},${r1(y1 + k)} ${r1(x1 + a)},${r1(y1)}Z`,
      width,
      filled: true,
    };
  }
  const k = (x2 - x1) * 0.5;
  if (!main) return { d: `M${r1(x1)},${r1(y1)}C${r1(x1 + k)},${r1(y1)} ${r1(x2 - k)},${r1(y2)} ${r1(x2)},${r1(y2)}`, width, filled: false };
  const a = width / 2;
  const b = Math.max(0.8, width * 0.22);
  return {
    d:
      `M${r1(x1)},${r1(y1 - a)}C${r1(x1 + k)},${r1(y1 - a)} ${r1(x2 - k)},${r1(y2 - b)} ${r1(x2)},${r1(y2 - b)}` +
      `L${r1(x2)},${r1(y2 + b)}C${r1(x2 - k)},${r1(y2 + b)} ${r1(x1 + k)},${r1(y1 + a)} ${r1(x1)},${r1(y1 + a)}Z`,
    width,
    filled: true,
  };
}
