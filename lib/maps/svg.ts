import type { MapDoc } from "./model";
import type { Box, Layout } from "./layout";
import { BADGE_RADIUS, EMOJI_FONT, ICON_PATHS, IMAGE_RADIUS, badgeInk, badgeText, baseline, cornerOf, emojiBaseline, esc, iconColor, n1 } from "./draw";

/**
 * A map as a standalone SVG file: what "Export → SVG" downloads and what
 * the gallery shows as a thumbnail. Built as a string from the layout the
 * editor draws, so it is the same picture.
 *
 * Images come in as data URLs (`images`), so the file needs nothing else to
 * open; fonts can be embedded the same way (`fontCss`). A thumbnail draws
 * each line of text as a soft bar — a few kilobytes, and the shape of the
 * map at a glance.
 */

export interface SvgOptions {
  /** Margin around the map, in pixels. */
  padding?: number;
  /** Draw the theme's canvas (and its dots or grid) behind the map. */
  background?: boolean;
  /** file → data URL (or URL) of each image. Missing ones are drawn as a frame. */
  images?: Map<string, string>;
  /** `@font-face` rules, embedded in the file. */
  fontCss?: string;
  /** Text as bars, images as frames, no icons: a light preview. */
  thumbnail?: boolean;
  /** Only these nodes (and the branches between them): exporting one branch. */
  only?: Set<string>;
  /** The title, for accessibility. */
  title?: string;
}

export function toSvg(doc: MapDoc, layout: Layout, opts: SvgOptions = {}): string {
  const pad = opts.padding ?? 40;
  const theme = layout.theme;
  const only = opts.only;
  const boxes = [...layout.boxes.values()].filter((b) => !only || only.has(b.id));
  const edges = layout.edges.filter((e) => !only || (only.has(e.from) && only.has(e.to)));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x, b.badge ? b.badge.x - BADGE_RADIUS : Infinity);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w, b.badge ? b.badge.x + BADGE_RADIUS : -Infinity);
    maxY = Math.max(maxY, b.y + b.h, b.badge ? b.badge.y + BADGE_RADIUS : -Infinity);
  }
  if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
  const x0 = minX - pad;
  const y0 = minY - pad;
  const w = Math.ceil(maxX - minX + pad * 2);
  const h = Math.ceil(maxY - minY + pad * 2);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${n1(x0)} ${n1(y0)} ${w} ${h}" role="img"${opts.title ? ` aria-label="${esc(opts.title)}"` : ""}>`
  );
  if (opts.title) out.push(`<title>${esc(opts.title)}</title>`);
  const defs: string[] = [];
  if (opts.fontCss) defs.push(`<style>${opts.fontCss}</style>`);
  if (opts.background !== false && doc.style.backdrop !== "plain" && !opts.thumbnail) {
    defs.push(
      doc.style.backdrop === "dots"
        ? `<pattern id="bg" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.2" fill="${theme.pattern}"/></pattern>`
        : `<pattern id="bg" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${theme.pattern}" stroke-width="1"/></pattern>`
    );
  }
  const rootBox = layout.boxes.get(doc.root);
  if (theme.root.glow && rootBox && (!only || only.has(doc.root))) {
    defs.push(`<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>`);
  }
  const clips: string[] = [];
  if (!opts.thumbnail) {
    for (const b of boxes) {
      if (!b.image) continue;
      clips.push(
        `<clipPath id="clip-${b.id}"><rect x="${n1(b.x + b.image.x)}" y="${n1(b.y + b.image.y)}" width="${b.image.w}" height="${b.image.h}" rx="${IMAGE_RADIUS}"/></clipPath>`
      );
    }
  }
  if (defs.length || clips.length) out.push(`<defs>${defs.join("")}${clips.join("")}</defs>`);

  if (opts.background !== false) {
    out.push(`<rect x="${n1(x0)}" y="${n1(y0)}" width="${w}" height="${h}" fill="${theme.background}"/>`);
    if (doc.style.backdrop !== "plain" && !opts.thumbnail) out.push(`<rect x="${n1(x0)}" y="${n1(y0)}" width="${w}" height="${h}" fill="url(#bg)"/>`);
  }

  // Branches under the nodes.
  out.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  for (const e of edges) {
    out.push(
      e.filled
        ? `<path d="${e.d}" fill="${e.color}" stroke="none"/>`
        : `<path d="${e.d}" stroke="${e.color}" stroke-width="${n1(e.width)}"/>`
    );
  }
  out.push(`</g>`);

  if (theme.root.glow && rootBox && (!only || only.has(doc.root))) {
    out.push(
      `<rect x="${n1(rootBox.x)}" y="${n1(rootBox.y)}" width="${rootBox.w}" height="${rootBox.h}" rx="${n1(cornerOf(rootBox))}" fill="${theme.root.fill}" opacity="0.45" filter="url(#glow)"/>`
    );
  }

  for (const b of boxes) out.push(nodeSvg(b, opts));
  out.push(`</svg>`);
  return out.join("");
}

function nodeSvg(b: Box, opts: SvgOptions): string {
  const parts: string[] = [];
  const look = b.look;
  const r = cornerOf(b);
  if (look.shape === "card" || look.shape === "pill") {
    parts.push(
      `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${b.w}" height="${b.h}" rx="${n1(r)}" fill="${look.fill ?? "none"}"${look.stroke ? ` stroke="${look.stroke}" stroke-width="${look.strokeWidth}"` : ""}/>`
    );
  } else if (look.shape === "underline" && look.underline) {
    parts.push(
      `<path d="M${n1(b.x)},${n1(b.y + b.h)}H${n1(b.x + b.w)}" stroke="${look.underline}" stroke-width="${n1(b.depth <= 2 ? 2 : 1.6)}" stroke-linecap="round" fill="none"/>`
    );
  }

  if (b.image) {
    const ix = b.x + b.image.x;
    const iy = b.y + b.image.y;
    const href = opts.images?.get(b.image.file);
    if (href && !opts.thumbnail) {
      parts.push(
        `<image href="${esc(href)}" xlink:href="${esc(href)}" x="${n1(ix)}" y="${n1(iy)}" width="${b.image.w}" height="${b.image.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${b.id})"/>`
      );
    } else {
      parts.push(
        `<rect x="${n1(ix)}" y="${n1(iy)}" width="${b.image.w}" height="${b.image.h}" rx="${IMAGE_RADIUS}" fill="${look.textColor}" opacity="0.12"/>`
      );
    }
  }

  if (b.emoji && !opts.thumbnail) {
    parts.push(`<text x="${n1(b.x + b.emoji.x)}" y="${n1(emojiBaseline(b))}" font-size="${b.emoji.size}" font-family='${EMOJI_FONT}'>${esc(b.emoji.char)}</text>`);
  }

  if (b.empty) {
    // An empty idea: its shape only.
  } else if (opts.thumbnail) {
    b.lines.forEach((line, i) => {
      if (!line.trim()) return;
      const lw = Math.max(6, (line.length / Math.max(1, longest(b))) * b.text.w);
      const bh = Math.max(3, look.fontSize * 0.5);
      const by = baseline(b, i) - look.fontSize * 0.55;
      parts.push(`<rect x="${n1(b.x + b.text.x)}" y="${n1(by)}" width="${n1(lw)}" height="${n1(bh)}" rx="${n1(bh / 2)}" fill="${look.textColor}" opacity="0.5"/>`);
    });
  } else {
    const anchorX = b.x + b.text.x;
    const tspans = b.lines.map((line, i) => `<tspan x="${n1(anchorX)}" y="${n1(baseline(b, i))}">${esc(line)}</tspan>`).join("");
    parts.push(
      `<text font-family="${esc(look.fontFamily)}" font-size="${look.fontSize}" font-weight="${look.fontWeight}" fill="${look.textColor}" xml:space="preserve">${tspans}</text>`
    );
    for (const icon of b.icons) {
      parts.push(
        `<path transform="translate(${n1(b.x + icon.x)} ${n1(b.y + icon.y)})" d="${ICON_PATHS[icon.kind]}" fill="none" stroke="${iconColor(b)}" stroke-opacity="0.7" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    }
  }

  if (b.badge) {
    parts.push(
      `<circle cx="${n1(b.badge.x)}" cy="${n1(b.badge.y)}" r="${BADGE_RADIUS}" fill="${look.branch}"/>` +
        (opts.thumbnail
          ? ""
          : `<text x="${n1(b.badge.x)}" y="${n1(b.badge.y + 3.5)}" text-anchor="middle" font-family="${esc(look.fontFamily)}" font-size="10" font-weight="700" fill="${badgeInk(look.branch)}">${badgeText(b.hidden)}</text>`)
    );
  }
  return `<g>${parts.join("")}</g>`;
}

const longest = (b: Box) => Math.max(...b.lines.map((l) => l.length));
