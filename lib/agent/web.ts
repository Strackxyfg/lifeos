import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

/**
 * Reading one public web page for the agent — the `web.research` capability.
 *
 * A server that fetches URLs chosen by a model is a classic way into the
 * network behind it (SSRF): a page, a note or the model itself names
 * `http://169.254.169.254/` or `http://localhost:5432/`, and the server
 * obligingly fetches it. So:
 *
 *  - http and https only, ports 80 and 443, no credentials in the URL, no
 *    `localhost`-style names;
 *  - the address is checked **inside the connection's own DNS lookup**, so
 *    the address checked is the address connected to — a name that resolves
 *    to a public address once and a private one the next time (DNS
 *    rebinding) cannot slip between a check and the request;
 *  - every redirect is a new URL, checked the same way, three at most;
 *  - text only (HTML, plain text, JSON, XML, Markdown), at most 1.5 MB read,
 *    10 s in all; HTML reduced to its text.
 *
 * What comes back is untrusted: the caller hands it to the model as data,
 * never as instructions.
 */

export const WEB_LIMITS = { bytes: 1_500_000, chars: 14_000, redirects: 3, timeoutMs: 10_000 } as const;

export type WebError = "invalid_url" | "not_public" | "unsupported" | "too_large" | "http_error" | "timeout" | "failed";

export type WebPage =
  | { ok: true; url: string; title: string | null; text: string; truncated: boolean }
  | { ok: false; error: WebError; detail?: string };

/* ── Addresses ────────────────────────────────────────────────────── */

const v4 = (ip: string): number[] | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
};

function publicV4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, documentation
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** The 8 groups of an IPv6 address, or null. */
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // An IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const tail = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const q = v4(tail[1]);
    if (!q) return null;
    s = s.slice(0, -tail[1].length) + `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

/** Whether an address belongs to the public internet — and not to us, our network, or the cloud's metadata. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.split("%")[0]);
  if (kind === 4) {
    const q = v4(ip);
    return q !== null && publicV4(q);
  }
  if (kind !== 6) return false;
  const g = v6(ip);
  if (!g) return false;
  const embedded = () => [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
  if (g.slice(0, 7).every((x) => x === 0)) return false; // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return publicV4(embedded()); // IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return publicV4(embedded()); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // discard
  if (g[0] === 0x2002) return publicV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]); // 6to4 carries an IPv4
  return true;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

/** A URL the agent may read, or why not. Checks the shape; the address is checked when connecting. */
export function checkUrl(raw: unknown, base?: URL): URL | WebError {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2_048) return "invalid_url";
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid_url";
  if (url.username || url.password) return "invalid_url";
  if (url.port && url.port !== "80" && url.port !== "443") return "not_public";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || BLOCKED_NAMES.test(host) || !host.includes(".") && !isIP(host)) return "not_public";
  if (isIP(host) && !isPublicAddress(host)) return "not_public";
  url.hash = "";
  return url;
}

/**
 * DNS for the connection itself: every address the name resolves to must be
 * public, or the connection is refused. `resolve` is swappable for tests.
 */
export function guardedLookup(resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = (Array.isArray(addresses) ? addresses : [addresses]) as LookupAddress[];
      if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
        const e = Object.assign(new Error("Refused: not a public address."), { code: "ENOTPUBLIC" });
        return callback(e, "", 0);
      }
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

/* ── Text ─────────────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", euro: "€", copy: "©" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The readable text of an HTML page, and its title. Scripts, styles and markup removed. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|object|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|footer|main|aside|nav|li|ul|ol|h[1-6]|tr|table|blockquote|pre|figure|figcaption|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() || null : null, text };
}

const TEXTUAL = /^(text\/(html|plain|markdown|xml|csv)|application\/(xhtml\+xml|json|ld\+json|xml|rss\+xml|atom\+xml))$/i;

/* ── Fetching ─────────────────────────────────────────────────────── */

interface Hop {
  status: number;
  location: string | null;
  type: string;
  charset: string | null;
  body: Buffer | null;
}

function decoded(res: IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(createGunzip());
  if (enc === "deflate") return res.pipe(createInflate());
  if (enc === "br") return res.pipe(createBrotliDecompress());
  return res;
}

function fetchOnce(url: URL, lookup: LookupFunction, deadline: number): Promise<Hop | WebError> {
  return new Promise((resolve) => {
    const left = deadline - Date.now();
    if (left <= 0) return resolve("timeout");
    // The whole exchange, not only each silence: a page sent a byte at a time stops at the deadline.
    const timer = setTimeout(() => {
      req.destroy();
      resolve("timeout");
    }, left);
    const done = (v: Hop | WebError) => {
      clearTimeout(timer);
      resolve(v);
    };
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        lookup,
        headers: {
          "User-Agent": "LifeOS-Agent/1.0 (reads one page at its owner's request)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.1",
          "Accept-Encoding": "gzip, deflate, br",
        },
        timeout: left,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const [type, ...params] = String(res.headers["content-type"] ?? "").split(";").map((s) => s.trim());
        const charset = params.find((p) => /^charset=/i.test(p))?.slice(8).replace(/"/g, "") ?? null;
        if (status >= 300 && status < 400) {
          res.resume();
          return done({ status, location: (res.headers.location as string | undefined) ?? null, type, charset, body: null });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return done({ status, location: null, type, charset, body: null });
        }
        if (type && !TEXTUAL.test(type)) {
          res.destroy();
          return done("unsupported");
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > WEB_LIMITS.bytes * 4) {
          res.destroy();
          return done("too_large");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decoded(res);
        stream.on("data", (c: Buffer) => {
          size += c.length;
          // Past the limit: keep what came, stop reading.
          if (size > WEB_LIMITS.bytes) {
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - WEB_LIMITS.bytes))));
            stream.destroy();
            res.destroy();
            done({ status, location: null, type, charset, body: Buffer.concat(chunks) });
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => done({ status, location: null, type, charset, body: Buffer.concat(chunks) }));
        stream.on("error", () => done(size > 0 ? { status, location: null, type, charset, body: Buffer.concat(chunks) } : "failed"));
      }
    );
    req.on("timeout", () => {
      req.destroy();
      done("timeout");
    });
    req.on("error", (e: NodeJS.ErrnoException) => done(e.code === "ENOTPUBLIC" ? "not_public" : "failed"));
    req.end();
  });
}

function decode(body: Buffer, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** Reads one public page as text. Never throws. */
export async function readPage(raw: unknown, opts: { lookup?: LookupFunction } = {}): Promise<WebPage> {
  const lookup = opts.lookup ?? guardedLookup();
  const deadline = Date.now() + WEB_LIMITS.timeoutMs;
  let url = checkUrl(raw);
  if (typeof url === "string") return { ok: false, error: url };

  for (let hop = 0; hop <= WEB_LIMITS.redirects; hop++) {
    const r = await fetchOnce(url, lookup, deadline);
    if (typeof r === "string") return { ok: false, error: r };
    if (r.status >= 300 && r.status < 400) {
      if (!r.location || hop === WEB_LIMITS.redirects) return { ok: false, error: "http_error", detail: `HTTP ${r.status}` };
      const next = checkUrl(r.location, url);
      if (typeof next === "string") return { ok: false, error: next };
      url = next;
      continue;
    }
    if (!r.body) return { ok: false, error: "http_error", detail: `HTTP ${r.status}` };
    const raw = decode(r.body, r.charset);
    const html = /html|xml/i.test(r.type) || (!r.type && /^\s*</.test(raw));
    const { title, text } = html ? htmlToText(raw) : { title: null, text: raw.trim() };
    const truncated = text.length > WEB_LIMITS.chars || r.body.length >= WEB_LIMITS.bytes;
    return { ok: true, url: url.href, title, text: text.slice(0, WEB_LIMITS.chars), truncated };
  }
  return { ok: false, error: "http_error" };
}
