/**
 * What another app shared, made into a note to confirm.
 *
 * The Web Share Target API hands over up to three fields — title, text, url —
 * and every app fills them differently: Chrome puts the page title in `title`
 * and the address in `text`; a notes app puts everything in `text`; some send
 * the URL twice. This turns them into one note: a title, a detail, and the
 * source address once.
 *
 * The fields arrive in a URL anyone can build, so they are data only: clipped,
 * and an address is kept only if it is http(s). Nothing is saved here — the
 * person confirms on the share page.
 */

export interface Shared {
  title: string;
  detail: string | null;
  url: string | null;
  /** Several ideas rather than one: offer to split it into notes. */
  long: boolean;
  /** Everything shared, for the brain dump. */
  full: string;
}

export const SHARE_LIMITS = { title: 200, text: 20_000, url: 2_000 } as const;

const tidy = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";

export function safeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+/i;

export function composeShared(input: { title?: unknown; text?: unknown; url?: unknown }): Shared | null {
  let title = tidy(input.title, SHARE_LIMITS.text);
  let text = tidy(input.text, SHARE_LIMITS.text);
  let url = safeUrl(tidy(input.url, SHARE_LIMITS.url));

  // An address sent in the text instead of the url field.
  if (!url) {
    const found = text.match(URL_IN_TEXT)?.[0] ?? null;
    url = found ? safeUrl(found) : null;
  }
  if (url) {
    const bare = url.replace(/\/$/, "");
    text = text.split(url).join("").split(bare).join("").trim();
    title = title.split(url).join("").split(bare).join("").trim();
  }
  if (text === title) text = "";
  if (!title && !text && !url) return null;

  // The title: the one given, or the text's first line, or the address.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let head = title;
  let rest = lines;
  if (!head && lines.length > 0) {
    head = lines[0];
    rest = lines.slice(1);
  }
  if (!head && url) head = url;
  const clipped = head.length > SHARE_LIMITS.title;
  const shownTitle = clipped ? `${head.slice(0, SHARE_LIMITS.title - 1).trimEnd()}…` : head;

  // Nothing lost: a title cut short keeps its full text in the detail.
  const detailParts = [clipped ? head : "", rest.join("\n")].filter(Boolean);
  const detail = detailParts.join("\n\n") || null;

  const body = [title, text].filter(Boolean).join("\n");
  const long = body.split("\n").filter((l) => l.trim()).length >= 3 || body.length > 280;
  const full = [body, url].filter(Boolean).join("\n\n");

  return { title: shownTitle, detail, url: url === head ? null : url, long, full };
}
