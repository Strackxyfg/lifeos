/**
 * Just enough XML to read OPML, FreeMind and XMind files — in the browser
 * and in tests alike, with no DOM.
 *
 * Safe by construction: a document type declaration is skipped, never
 * followed (no entity of its own, nothing fetched), only the five standard
 * entities and numeric character references are decoded, and nesting and
 * size are bounded.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const NAME = /^[A-Za-z_][\w.:-]*/;
const MAX_DEPTH = 256;
const MAX_LENGTH = 20_000_000;

export class XmlError extends Error {}

/** The document's root element. Throws `XmlError` on what is not well-formed enough to read. */
export function parseXml(input: string): XmlElement {
  if (input.length > MAX_LENGTH) throw new XmlError("File too large.");
  let i = 0;
  const s = input.replace(/^﻿/, "");
  const stack: XmlElement[] = [{ name: "#document", attrs: {}, children: [] }];

  const top = () => stack[stack.length - 1];
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      pushText(top(), s.slice(i));
      break;
    }
    if (lt > i) pushText(top(), s.slice(i, lt));
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      i = end < 0 ? s.length : end + 3;
    } else if (s.startsWith("<![CDATA[", lt)) {
      const end = s.indexOf("]]>", lt + 9);
      top().children.push(s.slice(lt + 9, end < 0 ? s.length : end));
      i = end < 0 ? s.length : end + 3;
    } else if (s.startsWith("<?", lt)) {
      const end = s.indexOf("?>", lt + 2);
      i = end < 0 ? s.length : end + 2;
    } else if (s.startsWith("<!", lt)) {
      // A DOCTYPE (with or without an internal subset): skipped, never applied.
      let depth = 0;
      let j = lt + 2;
      for (; j < s.length; j++) {
        if (s[j] === "[") depth++;
        else if (s[j] === "]") depth--;
        else if (s[j] === ">" && depth <= 0) break;
      }
      i = j + 1;
    } else if (s[lt + 1] === "/") {
      const end = s.indexOf(">", lt);
      if (end < 0) throw new XmlError("Unclosed tag.");
      const name = s.slice(lt + 2, end).trim();
      // Close up to the matching element (tolerating a missing close tag inside).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end + 1;
    } else {
      const m = NAME.exec(s.slice(lt + 1, lt + 200));
      if (!m) {
        pushText(top(), "<");
        i = lt + 1;
        continue;
      }
      const name = m[0];
      let j = lt + 1 + name.length;
      const attrs: Record<string, string> = {};
      // Attributes until > or />.
      for (;;) {
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === ">" || (s[j] === "/" && s[j + 1] === ">") || j >= s.length) break;
        const an = NAME.exec(s.slice(j, j + 200));
        if (!an) {
          j++;
          continue;
        }
        j += an[0].length;
        while (/\s/.test(s[j] ?? "")) j++;
        if (s[j] !== "=") {
          attrs[an[0]] = "";
          continue;
        }
        j++;
        while (/\s/.test(s[j] ?? "")) j++;
        const q = s[j];
        if (q === '"' || q === "'") {
          const close = s.indexOf(q, j + 1);
          const value = s.slice(j + 1, close < 0 ? s.length : close);
          attrs[an[0]] = decodeEntities(value);
          j = close < 0 ? s.length : close + 1;
        } else {
          const vm = /^[^\s>]+/.exec(s.slice(j));
          attrs[an[0]] = decodeEntities(vm?.[0] ?? "");
          j += vm?.[0].length ?? 0;
        }
      }
      const el: XmlElement = { name, attrs, children: [] };
      top().children.push(el);
      if (s[j] === "/") {
        i = j + 2;
      } else {
        i = j + 1;
        if (stack.length > MAX_DEPTH) throw new XmlError("Nested too deeply.");
        stack.push(el);
      }
    }
  }
  const root = stack[0].children.find((c): c is XmlElement => typeof c !== "string");
  if (!root) throw new XmlError("No element.");
  return root;
}

function pushText(el: XmlElement, raw: string) {
  if (!raw) return;
  el.children.push(decodeEntities(raw));
}

/** Local name, without a namespace prefix. */
export const local = (name: string) => name.slice(name.indexOf(":") + 1);

export const elements = (el: XmlElement, name?: string): XmlElement[] =>
  el.children.filter((c): c is XmlElement => typeof c !== "string" && (!name || local(c.name).toLowerCase() === name.toLowerCase()));

export const child = (el: XmlElement, name: string) => elements(el, name)[0];

/** All the text inside, block elements as line breaks. */
export function textOf(node: XmlNode): string {
  if (typeof node === "string") return node;
  const block = /^(p|div|li|br|h[1-6]|tr)$/i.test(local(node.name));
  const inner = node.children.map(textOf).join("");
  return block ? `${inner}\n` : inner;
}
