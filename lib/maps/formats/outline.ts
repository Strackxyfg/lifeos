import { LIMITS, cleanEmoji, cleanText, cleanUrl, type Outline } from "../model";
import { child, elements, escapeXml, parseXml, textOf, type XmlElement } from "./xml";

/**
 * The text formats a mind map travels in: Markdown, an indented outline (what
 * is pasted), OPML, FreeMind / Freeplane (.mm) and Mermaid. Each reads into
 * an `Outline` and writes from one. Reading is forgiving about form and
 * strict about size: an outline never grows past LIMITS.nodes.
 */

/** Stops reading once a file has given as many ideas as a map can hold. */
class Budget {
  left = LIMITS.nodes;
  take(): boolean {
    if (this.left <= 0) return false;
    this.left--;
    return true;
  }
}

const tidy = (s: string) => cleanText(s, LIMITS.text).replace(/\s+/g, " ").trim();

/* ── Indented text (paste) ──────────────────────────────────────────── */

const BULLET = /^(?:[-*+•▪◦‣–]|\d{1,3}[.)])\s+/;
const TASK = /^\[( |x|X)\]\s+/;

/**
 * Lines → a forest, by indentation (tabs, or the smallest indent used as one
 * level); list markers and checkboxes are understood. What a paste of a
 * list, a plan or a few lines becomes.
 */
export function parseIndented(text: string): Outline[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];
  const indentOf = (l: string) => {
    const m = /^[ \t]*/.exec(l)![0];
    let n = 0;
    for (const ch of m) n += ch === "\t" ? 4 : 1;
    return n;
  };
  const indents = lines.map(indentOf);
  const base = Math.min(...indents);
  const steps = indents.map((n) => n - base).filter((n) => n > 0);
  const unit = steps.length ? Math.min(...steps) : 1;
  const budget = new Budget();
  const roots: Outline[] = [];
  const stack: { depth: number; node: Outline }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!budget.take()) break;
    const depth = Math.round((indents[i] - base) / unit);
    let body = lines[i].trim().replace(BULLET, "");
    let emoji: string | undefined;
    const task = TASK.exec(body);
    if (task) {
      emoji = task[1] === " " ? "⬜" : "✅";
      body = body.slice(task[0].length);
    }
    const node = itemFromText(body, emoji);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) (parent.node.children ??= []).push(node);
    else roots.push(node);
    stack.push({ depth, node });
  }
  return roots;
}

/** "[Text](https://…)" or "Text https://…": the text, and the link apart. */
function itemFromText(raw: string, emoji?: string): Outline {
  let text = raw.replace(/\*\*|__|`/g, "");
  let link: string | undefined;
  const md = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(text);
  if (md && cleanUrl(md[2])) {
    link = cleanUrl(md[2]);
    text = text.replace(md[0], md[1]);
  } else {
    const bare = /(https?:\/\/[^\s)]+)/.exec(text);
    if (bare && cleanUrl(bare[1]) && text.trim() !== bare[1]) {
      link = cleanUrl(bare[1]);
      text = text.replace(bare[1], "").replace(/\s+[—–-]\s*$/, "");
    } else if (bare && text.trim() === bare[1]) link = cleanUrl(bare[1]);
  }
  const node: Outline = { text: tidy(text) };
  if (link) node.link = link;
  const e = cleanEmoji(emoji);
  if (e) node.emoji = e;
  return node;
}

/** One forest → one tree: a single top line is the root; several hang under `title`. */
export function asTree(forest: Outline[], title: string): Outline {
  if (forest.length === 1) return forest[0];
  return { text: title, children: forest };
}

export function toIndented(o: Outline, depth = 0): string {
  const pad = "\t".repeat(depth);
  const head = `${pad}${[o.emoji, o.text].filter(Boolean).join(" ")}`;
  return [head, ...(o.children ?? []).map((c) => toIndented(c, depth + 1))].join("\n");
}

/* ── Markdown ───────────────────────────────────────────────────────── */

/**
 * The root as a title, the main branches as sections, everything deeper as
 * nested lists; a note follows its idea, quoted. Reads back the same way,
 * and also reads most Markdown outlines (headings and lists of any depth).
 */
export function toMarkdown(o: Outline): string {
  const out: string[] = [];
  const name = (n: Outline) => {
    const text = [n.emoji, n.text.replace(/\n+/g, " ")].filter(Boolean).join(" ") || "…";
    return n.link ? `[${text.replace(/[[\]]/g, "")}](${n.link})` : text;
  };
  const note = (n: Outline, prefix: string) => {
    if (!n.note?.trim()) return;
    for (const line of n.note.trim().split("\n")) out.push(`${prefix}> ${line}`.trimEnd());
  };
  out.push(`# ${name(o)}`, "");
  if (o.note?.trim()) {
    out.push(o.note.trim(), "");
  }
  for (const c of o.children ?? []) {
    out.push(`## ${name(c)}`, "");
    if (c.note?.trim()) out.push(c.note.trim(), "");
    const list = (n: Outline, depth: number) => {
      const indent = "  ".repeat(depth);
      out.push(`${indent}- ${name(n)}`);
      note(n, `${indent}  `);
      for (const k of n.children ?? []) list(k, depth + 1);
    };
    for (const g of c.children ?? []) list(g, 0);
    if (c.children?.length) out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function parseMarkdown(text: string, fallbackTitle: string): Outline {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const budget = new Budget();
  const top: Outline = { text: fallbackTitle, children: [] };
  // Headings form the spine; lists hang under the last heading.
  const heads: { level: number; node: Outline }[] = [];
  let list: { indent: number; node: Outline }[] = [];
  let last: Outline | null = null;
  let h1: Outline | null = null;
  let h1Count = 0;
  let inCode = false;

  const attach = (parent: Outline, node: Outline) => (parent.children ??= []).push(node);

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !raw.trim()) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      if (!budget.take()) break;
      const level = heading[1].length;
      const node = itemFromText(heading[2].replace(/\s+#+\s*$/, ""));
      while (heads.length && heads[heads.length - 1].level >= level) heads.pop();
      const parent = heads[heads.length - 1]?.node ?? top;
      if (level === 1) {
        h1Count++;
        h1 ??= node;
      }
      attach(parent, node);
      heads.push({ level, node });
      list = [];
      last = node;
      continue;
    }
    const item = /^(\s*)(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(raw);
    if (item) {
      if (!budget.take()) break;
      let indent = 0;
      for (const ch of item[1]) indent += ch === "\t" ? 4 : 1;
      let body = item[2];
      let emoji: string | undefined;
      const task = TASK.exec(body);
      if (task) {
        emoji = task[1] === " " ? "⬜" : "✅";
        body = body.slice(task[0].length);
      }
      const node = itemFromText(body, emoji);
      while (list.length && list[list.length - 1].indent >= indent) list.pop();
      const parent = list[list.length - 1]?.node ?? heads[heads.length - 1]?.node ?? top;
      attach(parent, node);
      list.push({ indent, node });
      last = node;
      continue;
    }
    // Any other line: the note of the idea above it.
    const line = raw.replace(/^\s*>\s?/, "").trimEnd();
    const target = last ?? top;
    const note = cleanText(target.note ? `${target.note}\n${line.trim()}` : line.trim(), LIMITS.note);
    if (note) target.note = note;
  }
  // One title over everything: it is the root.
  if (h1Count === 1 && top.children?.length === 1 && top.children[0] === h1) return h1;
  if (!top.children?.length) top.children = undefined;
  return top;
}

/* ── OPML ───────────────────────────────────────────────────────────── */

export function toOpml(o: Outline, title: string): string {
  const node = (n: Outline, depth: number): string => {
    const pad = "  ".repeat(depth + 2);
    const attrs = [`text="${escapeXml([n.emoji, n.text].filter(Boolean).join(" "))}"`];
    if (n.note?.trim()) attrs.push(`_note="${escapeXml(n.note)}"`);
    if (n.link) attrs.push(`type="link" url="${escapeXml(n.link)}"`);
    const kids = n.children ?? [];
    return kids.length
      ? `${pad}<outline ${attrs.join(" ")}>\n${kids.map((k) => node(k, depth + 1)).join("\n")}\n${pad}</outline>`
      : `${pad}<outline ${attrs.join(" ")}/>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${escapeXml(title)}</title>\n  </head>\n  <body>\n${node(o, 0)}\n  </body>\n</opml>\n`;
}

export function parseOpml(text: string, fallbackTitle: string): Outline {
  const doc = parseXml(text);
  const body = child(doc, "body");
  const title = tidy(textOf(child(child(doc, "head") ?? doc, "title") ?? "")) || fallbackTitle;
  const budget = new Budget();
  const read = (el: XmlElement): Outline | null => {
    if (!budget.take()) return null;
    const node = itemFromText(el.attrs.text ?? el.attrs.title ?? "");
    const url = cleanUrl(el.attrs.url ?? el.attrs.htmlUrl ?? el.attrs.xmlUrl);
    if (url) node.link = url;
    const note = cleanText(el.attrs._note ?? "", LIMITS.note).trim();
    if (note) node.note = note;
    const kids = elements(el, "outline").map(read).filter((k): k is Outline => !!k);
    if (kids.length) node.children = kids;
    return node;
  };
  const forest = body ? elements(body, "outline").map(read).filter((k): k is Outline => !!k) : [];
  return asTree(forest, title);
}

/* ── FreeMind / Freeplane ───────────────────────────────────────────── */

/** FreeMind's built-in icons that have an obvious emoji. */
const FREEMIND_ICONS: Record<string, string> = {
  idea: "💡",
  help: "❓",
  yes: "👍",
  no: "👎",
  button_ok: "✅",
  button_cancel: "❌",
  messagebox_warning: "⚠️",
  stop: "🛑",
  "stop-sign": "🛑",
  flag: "🚩",
  "flag-green": "🚩",
  "flag-orange": "🚩",
  "flag-pink": "🚩",
  "flag-yellow": "🚩",
  "flag-black": "🏴",
  bookmark: "🔖",
  attach: "📎",
  pencil: "✏️",
  password: "🔑",
  launch: "🚀",
  ksmiletris: "🙂",
  smily_bad: "😟",
  clanbomber: "💣",
  desktop_new: "🖥️",
  gohome: "🏠",
  forward: "➡️",
  back: "⬅️",
  up: "⬆️",
  down: "⬇️",
  calendar: "📅",
  "full-1": "1️⃣",
  "full-2": "2️⃣",
  "full-3": "3️⃣",
  "full-4": "4️⃣",
  "full-5": "5️⃣",
  "full-6": "6️⃣",
  "full-7": "7️⃣",
  "full-8": "8️⃣",
  "full-9": "9️⃣",
  wizard: "🧙",
  bell: "🔔",
  licq: "🌼",
  freemind_butterfly: "🦋",
  male1: "👤",
  female1: "👤",
  family: "👪",
  korn: "📬",
  list: "📋",
  info: "ℹ️",
  xmag: "🔍",
  bulb: "💡",
  heart: "❤️",
};

export function toFreemind(o: Outline): string {
  let n = 0;
  const node = (x: Outline, depth: number, side?: "left" | "right"): string => {
    const pad = "  ".repeat(depth + 1);
    const attrs = [`TEXT="${escapeXml([x.emoji, x.text].filter(Boolean).join(" "))}"`, `ID="ID_${++n}"`];
    if (x.link) attrs.push(`LINK="${escapeXml(x.link)}"`);
    if (side) attrs.push(`POSITION="${side}"`);
    if (x.collapsed && x.children?.length) attrs.push(`FOLDED="true"`);
    const inner: string[] = [];
    if (x.color && depth === 1) inner.push(`${pad}  <edge COLOR="${x.color}"/>`);
    if (x.note?.trim()) {
      const html = x.note.trim().split("\n").map((l) => `<p>${escapeXml(l)}</p>`).join("");
      inner.push(`${pad}  <richcontent TYPE="NOTE"><html><head></head><body>${html}</body></html></richcontent>`);
    }
    for (const c of x.children ?? []) inner.push(node(c, depth + 1, depth === 0 ? (c.side ?? undefined) : undefined));
    return inner.length ? `${pad}<node ${attrs.join(" ")}>\n${inner.join("\n")}\n${pad}</node>` : `${pad}<node ${attrs.join(" ")}/>`;
  };
  return `<map version="1.0.1">\n<!-- To view this file, download free mind mapping software Freeplane or FreeMind -->\n${node(o, 0)}\n</map>\n`;
}

export function parseFreemind(text: string, fallbackTitle: string): Outline {
  const doc = parseXml(text);
  const rootEl = child(doc, "node");
  if (!rootEl) return { text: fallbackTitle };
  const budget = new Budget();
  const read = (el: XmlElement, depth: number): Outline | null => {
    if (!budget.take()) return null;
    let label = el.attrs.TEXT ?? el.attrs.text ?? "";
    let note = "";
    for (const rc of elements(el, "richcontent")) {
      const type = (rc.attrs.TYPE ?? "").toUpperCase();
      const body = cleanText(textOf(rc), LIMITS.note).replace(/\n{2,}/g, "\n").trim();
      if (type === "NOTE" || type === "DETAILS") note = note ? `${note}\n${body}` : body;
      else if (!label) label = body;
    }
    const node = itemFromText(label);
    const emoji = elements(el, "icon").map((i) => FREEMIND_ICONS[i.attrs.BUILTIN ?? ""]).find(Boolean);
    if (emoji && !node.emoji) node.emoji = cleanEmoji(emoji);
    const url = cleanUrl(el.attrs.LINK);
    if (url) node.link = url;
    if (note) node.note = note;
    if (depth === 1 && (el.attrs.POSITION === "left" || el.attrs.POSITION === "right")) node.side = el.attrs.POSITION;
    const edge = child(el, "edge");
    const color = /^#[0-9a-f]{6}$/i.test(edge?.attrs.COLOR ?? "") ? edge!.attrs.COLOR.toLowerCase() : undefined;
    if (color && depth === 1) node.color = color;
    const kids = elements(el, "node").map((k) => read(k, depth + 1)).filter((k): k is Outline => !!k);
    if (kids.length) node.children = kids;
    if (el.attrs.FOLDED === "true" && kids.length) node.collapsed = true;
    return node;
  };
  return read(rootEl, 0) ?? { text: fallbackTitle };
}

/* ── Mermaid ────────────────────────────────────────────────────────── */

/** Mermaid's `mindmap` diagram: what a README, a wiki or a slide can draw. */
export function toMermaid(o: Outline): string {
  let n = 0;
  const quote = (s: string) => s.replace(/"/g, "#quot;").replace(/\n+/g, " ");
  const lines = ["mindmap"];
  const walk = (x: Outline, depth: number) => {
    const text = quote([x.emoji, x.text].filter(Boolean).join(" ") || "…");
    lines.push(`${"  ".repeat(depth + 1)}${depth === 0 ? `root(("${text}"))` : `n${++n}["${text}"]`}`);
    for (const c of x.children ?? []) walk(c, depth + 1);
  };
  walk(o, 0);
  return lines.join("\n") + "\n";
}

export function parseMermaid(text: string, fallbackTitle: string): Outline {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^\s*mindmap\s*$/.test(l));
  const body = lines.slice(start + 1).filter((l) => l.trim() && !/^\s*(%%|::icon|:::)/.test(l));
  const strip = (s: string) => {
    const t = s.trim();
    // id((text)), id[text], id(text), id))text((, id)text(, id{{text}} — or bare text.
    const shaped = /^[\w-]*\s*(\(\(|\)\)|\(|\)|\[|\{\{)(.*?)(\)\)|\(\(|\)|\(|\]|\}\})$/.exec(t);
    const inner = shaped ? shaped[2] : t;
    return inner.replace(/^"(.*)"$/, "$1").replace(/^`(.*)`$/, "$1").replace(/#quot;/g, '"');
  };
  const forest = parseIndented(body.map((l) => l.replace(/^(\s*)(.*)$/, (_m, sp: string, rest: string) => sp + strip(rest))).join("\n"));
  return asTree(forest, fallbackTitle);
}
