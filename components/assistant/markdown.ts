/**
 * The little Markdown models write — paragraphs, lists, bold, italics,
 * inline code, the odd heading — as plain data the page turns into
 * elements. Never HTML: whatever the text holds is shown as text.
 */

export type Inline = { kind: "text" | "strong" | "em" | "code"; text: string };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "h"; inline: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][] };

const INLINE = /(\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+?)`|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_]))/g;

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: s.slice(last, at) });
    if (m[2] ?? m[3]) out.push({ kind: "strong", text: (m[2] ?? m[3]) as string });
    else if (m[4]) out.push({ kind: "code", text: m[4] });
    else out.push({ kind: "em", text: (m[5] ?? m[6]) as string });
    last = at + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(HEADING);
    const b = line.match(BULLET);
    const n = line.match(NUMBERED);
    if (h) {
      flush();
      blocks.push({ kind: "h", inline: inline(h[1]) });
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
