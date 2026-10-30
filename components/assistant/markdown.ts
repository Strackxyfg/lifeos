/**
 * The Markdown models write — paragraphs, lists, emphasis, inline code,
 * links, headings, quotes, fenced code and tables — as plain data the page
 * turns into elements. Never HTML: whatever the text holds is shown as text,
 * and a link is kept only when it points to the web or to a mail address.
 */

export type Inline =
  | { kind: "text" | "strong" | "em" | "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "h"; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][] }
  | { kind: "quote"; lines: Inline[][] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

/** A link target the page may follow: the web, or mail. */
export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.href : null;
  } catch {
    return null;
  }
}

const INLINE =
  /(\[([^\]\n]{1,300})\]\(((?:[^\s()]|\([^\s()]*\)){1,2048})\)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+?)`|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const text = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === "text") prev.text += t;
    else out.push({ kind: "text", text: t });
  };
  for (const m of s.matchAll(INLINE)) {
    const at = m.index ?? 0;
    text(s.slice(last, at));
    last = at + m[0].length;
    if (m[2] !== undefined) {
      const href = safeHref(m[3]);
      if (href) out.push({ kind: "link", text: m[2], href });
      else text(m[2]);
    } else if (m[4] ?? m[5]) out.push({ kind: "strong", text: (m[4] ?? m[5]) as string });
    else if (m[6]) out.push({ kind: "code", text: m[6] });
    else if (m[7] ?? m[8]) out.push({ kind: "em", text: (m[7] ?? m[8]) as string });
    else {
      const href = safeHref(m[0]);
      if (href) out.push({ kind: "link", text: m[0], href });
      else text(m[0]);
    }
  }
  text(s.slice(last));
  return out;
}

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => inline(c.trim()));

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: Inline[][] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith(fence[1])) body.push(lines[j++]);
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      i = j; // the closing fence, or the end
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A table: a row of cells, then a rule of dashes.
    if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      const head = cells(line);
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) rows.push(cells(lines[j++]));
      blocks.push({ kind: "table", head, rows });
      i = j - 1;
      continue;
    }
    const h = line.match(HEADING);
    const q = line.match(QUOTE);
    const b = line.match(BULLET);
    const n = line.match(NUMBERED);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: (Math.min(h[1].length, 3) as 1 | 2 | 3), inline: inline(h[2]) });
    } else if (q) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === "quote") prev.lines.push(inline(q[1]));
      else blocks.push({ kind: "quote", lines: [inline(q[1])] });
    } else if (b || n) {
      flush();
      const kind = b ? "ul" : "ol";
      const item = inline((b ?? n)![1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (/^\s{2,}\S/.test(raw) && blocks.length && !para.length && (blocks[blocks.length - 1].kind === "ul" || blocks[blocks.length - 1].kind === "ol")) {
      // An indented line under a list item continues it.
      const list = blocks[blocks.length - 1] as Extract<Block, { kind: "ul" | "ol" }>;
      list.items[list.items.length - 1].push({ kind: "text", text: " " }, ...inline(line.trim()));
    } else {
      para.push(inline(line.trim()));
    }
  }
  flush();
  return blocks;
}
