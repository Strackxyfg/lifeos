import type { MapDoc } from "./model";
import type { Layout } from "./layout";
import { BADGE_RADIUS, EMOJI_FONT, ICON_PATHS, IMAGE_RADIUS, badgeInk, badgeText, baseline, cornerOf, emojiBaseline, iconColor } from "./draw";

/**
 * A map painted on a canvas — the PNG export (and "copy as image"). The same
 * layout and the same placement rules as the SVG, drawn with the fonts the
 * page has loaded, so the picture matches the editor.
 */

export interface PaintOptions {
  /** Pixels per map unit: 2 for a sharp image on most screens. */
  scale: number;
  padding: number;
  /** The theme's canvas behind the map; off, a transparent picture. */
  background: boolean;
  /** file → loaded image. */
  images: Map<string, CanvasImageSource>;
  only?: Set<string>;
}

export function paintBounds(layout: Layout, only?: Set<string>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of layout.boxes.values()) {
    if (only && !only.has(b.id)) continue;
    minX = Math.min(minX, b.x, b.badge ? b.badge.x - BADGE_RADIUS : Infinity);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w, b.badge ? b.badge.x + BADGE_RADIUS : -Infinity);
    maxY = Math.max(maxY, b.y + b.h, b.badge ? b.badge.y + BADGE_RADIUS : -Infinity);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints onto a context sized `bounds × scale + padding`; returns nothing. */
export function paintMap(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, doc: MapDoc, layout: Layout, opts: PaintOptions) {
  const theme = layout.theme;
  const bounds = paintBounds(layout, opts.only);
  const { scale, padding } = opts;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(padding - bounds.x, padding - bounds.y);
  const area = { x: bounds.x - padding, y: bounds.y - padding, w: bounds.w + padding * 2, h: bounds.h + padding * 2 };

  if (opts.background) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    if (doc.style.backdrop !== "plain") {
      ctx.fillStyle = theme.pattern;
      ctx.strokeStyle = theme.pattern;
      ctx.lineWidth = 1;
      const step = 24;
      const sx = Math.floor(area.x / step) * step;
      const sy = Math.floor(area.y / step) * step;
      if (doc.style.backdrop === "dots") {
        for (let x = sx; x < area.x + area.w; x += step)
          for (let y = sy; y < area.y + area.h; y += step) {
            ctx.beginPath();
            ctx.arc(x + 12, y + 12, 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
      } else {
        ctx.beginPath();
        for (let x = sx; x < area.x + area.w; x += step) {
          ctx.moveTo(x, area.y);
          ctx.lineTo(x, area.y + area.h);
        }
        for (let y = sy; y < area.y + area.h; y += step) {
          ctx.moveTo(area.x, y);
          ctx.lineTo(area.x + area.w, y);
        }
        ctx.stroke();
      }
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const e of layout.edges) {
    if (opts.only && !(opts.only.has(e.from) && opts.only.has(e.to))) continue;
    const p = new Path2D(e.d);
    if (e.filled) {
      ctx.fillStyle = e.color;
      ctx.fill(p);
    } else {
      ctx.strokeStyle = e.color;
      ctx.lineWidth = e.width;
      ctx.stroke(p);
    }
  }

  const root = layout.boxes.get(doc.root);
  if (theme.root.glow && root && (!opts.only || opts.only.has(doc.root))) {
    ctx.save();
    ctx.shadowColor = theme.root.fill;
    ctx.shadowBlur = 28 * scale;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = theme.root.fill;
    roundRect(ctx, root.x, root.y, root.w, root.h, cornerOf(root));
    ctx.fill();
    ctx.restore();
  }

  for (const b of layout.boxes.values()) {
    if (opts.only && !opts.only.has(b.id)) continue;
    const look = b.look;
    if (look.shape === "card" || look.shape === "pill") {
      roundRect(ctx, b.x, b.y, b.w, b.h, cornerOf(b));
      if (look.fill) {
        ctx.fillStyle = look.fill;
        ctx.fill();
      }
      if (look.stroke && look.strokeWidth) {
        ctx.strokeStyle = look.stroke;
        ctx.lineWidth = look.strokeWidth;
        ctx.stroke();
      }
    } else if (look.shape === "underline" && look.underline) {
      ctx.strokeStyle = look.underline;
      ctx.lineWidth = b.depth <= 2 ? 2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.h);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.stroke();
    }

    if (b.image) {
      const ix = b.x + b.image.x;
      const iy = b.y + b.image.y;
      const img = opts.images.get(b.image.file);
      ctx.save();
      roundRect(ctx, ix, iy, b.image.w, b.image.h, IMAGE_RADIUS);
      if (img) {
        ctx.clip();
        // Cover: fill the frame, cropping what overflows (as `slice` does in the SVG).
        const src = img as { width: number; height: number };
        const s = Math.max(b.image.w / src.width, b.image.h / src.height);
        const dw = src.width * s;
        const dh = src.height * s;
        ctx.drawImage(img, ix + (b.image.w - dw) / 2, iy + (b.image.h - dh) / 2, dw, dh);
      } else {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = look.textColor;
        ctx.fill();
      }
      ctx.restore();
    }

    if (b.emoji) {
      ctx.font = `${b.emoji.size}px ${EMOJI_FONT}`;
      ctx.fillStyle = look.textColor;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(b.emoji.char, b.x + b.emoji.x, emojiBaseline(b));
    }

    if (!b.empty) {
      ctx.font = b.font;
      ctx.fillStyle = look.textColor;
      ctx.textBaseline = "alphabetic";
      b.lines.forEach((line, i) => ctx.fillText(line, b.x + b.text.x, baseline(b, i)));
      for (const icon of b.icons) {
        ctx.save();
        ctx.translate(b.x + icon.x, b.y + icon.y);
        ctx.strokeStyle = iconColor(b);
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.3;
        ctx.stroke(new Path2D(ICON_PATHS[icon.kind]));
        ctx.restore();
      }
    }

    if (b.badge) {
      ctx.beginPath();
      ctx.arc(b.badge.x, b.badge.y, BADGE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = look.branch;
      ctx.fill();
      ctx.font = `700 10px ${look.fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillStyle = badgeInk(look.branch);
      ctx.fillText(badgeText(b.hidden), b.badge.x, b.badge.y + 3.5);
      ctx.textAlign = "start";
    }
  }
  ctx.restore();
}
