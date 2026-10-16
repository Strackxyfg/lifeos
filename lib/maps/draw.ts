import type { Box, IconSlot } from "./layout";
import { readableOn } from "./theme";

/**
 * What every renderer shares — the editor's SVG, the SVG export and the PNG
 * painter all place text, icons and badges with these, so the three draw
 * the same picture.
 */

/** The alphabetic baseline of a box's line `i`, in map space. */
export const baseline = (b: Box, i: number) =>
  b.y + b.text.y + i * b.look.lineHeight + (b.look.lineHeight - b.look.fontSize) / 2 + b.look.fontSize * 0.8;

export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/** The emoji's baseline. */
export const emojiBaseline = (b: Box) => b.y + (b.emoji ? b.emoji.y + b.emoji.size * 0.86 : 0);

/** Icons drawn in a 14 × 14 square, as strokes. */
export const ICON_PATHS: Record<IconSlot["kind"], string> = {
  note: "M3.5 1.75h5l2.75 2.75v7.75h-7.75zM5.5 6.75h4M5.5 9h4",
  link: "M6 8.25a2.6 2.6 0 0 0 3.7.2l1.9-1.9a2.6 2.6 0 0 0-3.7-3.7l-.7.7M8 5.75a2.6 2.6 0 0 0-3.7-.2l-1.9 1.9a2.6 2.6 0 0 0 3.7 3.7l.7-.7",
  brain:
    "M7 2.6a2.3 2.3 0 0 0-4.2 1.3 2.2 2.2 0 0 0 .4 3.9 2.3 2.3 0 0 0 3.8 2.6M7 2.6a2.3 2.3 0 0 1 4.2 1.3 2.2 2.2 0 0 1-.4 3.9 2.3 2.3 0 0 1-3.8 2.6M7 2.6v7.8",
};

/** Icons take the text's colour, a little quieter. */
export const iconColor = (b: Box) => b.look.textColor;

/** The folded badge: how many ideas wait under the node. */
export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
export const badgeInk = (branch: string) => readableOn(branch, "#111114", "#ffffff");
export const BADGE_RADIUS = 10;

/** A box's corner radius, never more than half its height. */
export const cornerOf = (b: Box) => Math.min(b.look.radius, b.h / 2);

/** An image's rounded corners. */
export const IMAGE_RADIUS = 6;

/** XML text and attribute escaping. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One decimal: enough for screens, and short files. */
export const n1 = (v: number) => String(Math.round(v * 10) / 10);
