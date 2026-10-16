import type { Density, FontKind, MapStyle, ThemeId } from "./model";

/**
 * How a map looks. A theme sets the canvas, the root, the branch colours and
 * the way each level is drawn; the map's style chooses over it (layout,
 * edges, font, density, backdrop, one colour or one per branch).
 *
 * Text on a coloured shape takes whichever of the theme's ink or white reads
 * better on it (WCAG contrast), so no colour choice makes a label hard to
 * read.
 */

export type Fill = "solid" | "soft" | "outline";
export type Shape = "card" | "pill" | "underline" | "plain";

export interface Theme {
  id: ThemeId;
  name: { en: string; fr: string };
  dark: boolean;
  background: string;
  /** The dots or the grid of the backdrop. */
  pattern: string;
  text: string;
  muted: string;
  /** Every branch's colour when the map is not in colours. */
  accent: string;
  root: { fill: string; text: string; stroke?: string; glow?: boolean };
  palette: string[];
  /** The main branches' nodes. */
  level1: { fill: Fill; shape: Exclude<Shape, "underline"> };
  /** Everything deeper. */
  deeper: Shape;
  /** Width of the root's branches; deeper ones are thinner. */
  edgeWidth: number;
  /** The font the theme is drawn for, offered first. */
  font: FontKind;
}

export const THEMES: Record<ThemeId, Theme> = {
  daylight: {
    id: "daylight",
    name: { en: "Daylight", fr: "Lumière" },
    dark: false,
    background: "#f7f7f5",
    pattern: "rgba(24,24,27,0.09)",
    text: "#1c1c22",
    muted: "#71717a",
    accent: "#2563eb",
    root: { fill: "#18181b", text: "#fafafa" },
    palette: ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#0284c7"],
    level1: { fill: "soft", shape: "pill" },
    deeper: "underline",
    edgeWidth: 3.4,
    font: "sans",
  },
  midnight: {
    id: "midnight",
    name: { en: "Midnight", fr: "Minuit" },
    dark: true,
    background: "#0c0e14",
    pattern: "rgba(255,255,255,0.07)",
    text: "#e9e9ef",
    muted: "#8b8b98",
    accent: "#60a5fa",
    root: { fill: "#eceef4", text: "#0c0e14", glow: true },
    palette: ["#60a5fa", "#a78bfa", "#f472b6", "#fb923c", "#fbbf24", "#4ade80", "#2dd4bf", "#38bdf8"],
    level1: { fill: "soft", shape: "pill" },
    deeper: "underline",
    edgeWidth: 3.4,
    font: "sans",
  },
  paper: {
    id: "paper",
    name: { en: "Paper", fr: "Papier" },
    dark: false,
    background: "#f4efe4",
    pattern: "rgba(90,70,40,0.10)",
    text: "#2b2620",
    muted: "#7d7263",
    accent: "#9b4d34",
    root: { fill: "#2b2620", text: "#f4efe4" },
    palette: ["#9b4d34", "#4f6d3a", "#365f7a", "#7f4f86", "#a1772b", "#2f6b62", "#7a3e4f", "#5b5f97"],
    level1: { fill: "outline", shape: "card" },
    deeper: "underline",
    edgeWidth: 2.6,
    font: "serif",
  },
  ocean: {
    id: "ocean",
    name: { en: "Ocean", fr: "Océan" },
    dark: true,
    background: "#06182b",
    pattern: "rgba(120,200,255,0.08)",
    text: "#e3f2ff",
    muted: "#7fa3c2",
    accent: "#22d3ee",
    root: { fill: "#22d3ee", text: "#04111f", glow: true },
    palette: ["#22d3ee", "#38bdf8", "#818cf8", "#2dd4bf", "#f472b6", "#60a5fa", "#fcd34d", "#a3e635"],
    level1: { fill: "soft", shape: "pill" },
    deeper: "underline",
    edgeWidth: 3.2,
    font: "sans",
  },
  forest: {
    id: "forest",
    name: { en: "Forest", fr: "Forêt" },
    dark: false,
    background: "#f1f4ee",
    pattern: "rgba(30,60,30,0.10)",
    text: "#1e2a1f",
    muted: "#6b7a68",
    accent: "#2f7d4f",
    root: { fill: "#1f3d2b", text: "#f1f4ee" },
    palette: ["#2f7d4f", "#5f7f1f", "#9a5419", "#8b5e3c", "#33708f", "#8f6a1f", "#55704f", "#9a3b3b"],
    level1: { fill: "solid", shape: "card" },
    deeper: "underline",
    edgeWidth: 3,
    font: "sans",
  },
  aurora: {
    id: "aurora",
    name: { en: "Aurora", fr: "Aurore" },
    dark: true,
    background: "#0b0a1a",
    pattern: "rgba(200,180,255,0.08)",
    text: "#ece9ff",
    muted: "#9a93c9",
    accent: "#a78bfa",
    root: { fill: "#c4b5fd", text: "#120f2a", glow: true },
    palette: ["#a78bfa", "#f472b6", "#22d3ee", "#34d399", "#facc15", "#fb7185", "#60a5fa", "#e879f9"],
    level1: { fill: "solid", shape: "pill" },
    deeper: "underline",
    edgeWidth: 3.4,
    font: "sans",
  },
  ink: {
    id: "ink",
    name: { en: "Ink", fr: "Encre" },
    dark: false,
    background: "#ffffff",
    pattern: "rgba(0,0,0,0.07)",
    text: "#111111",
    muted: "#6b6b6b",
    accent: "#111111",
    root: { fill: "#111111", text: "#ffffff" },
    palette: ["#111111", "#3f3f46", "#27272a", "#52525b", "#18181b", "#3f3f46", "#27272a", "#52525b"],
    level1: { fill: "outline", shape: "card" },
    deeper: "underline",
    edgeWidth: 2.2,
    font: "mono",
  },
  pastel: {
    id: "pastel",
    name: { en: "Pastel", fr: "Pastel" },
    dark: false,
    background: "#fbf8ff",
    pattern: "rgba(120,80,160,0.08)",
    text: "#2d2640",
    muted: "#857d99",
    accent: "#a5b4fc",
    root: { fill: "#ffffff", text: "#2d2640", stroke: "#d9cff0" },
    palette: ["#a5b4fc", "#f9a8d4", "#fdba74", "#86efac", "#93c5fd", "#c4b5fd", "#fcd34d", "#5eead4"],
    level1: { fill: "solid", shape: "pill" },
    deeper: "underline",
    edgeWidth: 3.6,
    font: "sans",
  },
};

export const themeOf = (style: Pick<MapStyle, "theme">): Theme => THEMES[style.theme] ?? THEMES.daylight;

/* ── Colour ─────────────────────────────────────────────────────────── */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Relative luminance (WCAG 2). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of the two inks reads better on `background`. */
export const readableOn = (background: string, dark = "#111114", light = "#ffffff") =>
  contrast(background, dark) >= contrast(background, light) ? dark : light;

/** `hex` laid over `under` at `alpha`: a tint with no transparency, so exports look the same everywhere. */
export function mix(hex: string, under: string, alpha: number): string {
  const a = rgb(hex);
  const b = rgb(under);
  const c = a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/* ── Fonts ──────────────────────────────────────────────────────────── */

/** The CSS families each font choice resolves to; the page passes the loaded webfont's real name first. */
export const FONT_STACK: Record<FontKind, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, "Iowan Old Style", "Charter", Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
};

/** Families resolved on the page (the loaded webfont first), or the stacks alone. */
export type FontFamilies = Record<FontKind, string>;
export const DEFAULT_FAMILIES: FontFamilies = { ...FONT_STACK };

/* ── Per level ──────────────────────────────────────────────────────── */

export interface NodeLook {
  depth: number;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  fontFamily: string;
  padX: number;
  padY: number;
  radius: number;
  maxTextWidth: number;
  imageMax: { width: number; height: number };
  shape: Shape;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  textColor: string;
  /** The line under an "underline" node, in its branch's colour. */
  underline: string | null;
  branch: string;
}

const SPACING: Record<Density, number> = { compact: 0.78, normal: 1, airy: 1.28 };

export interface Spacing {
  /** Between a node and its children. */
  rank: number;
  /** Between siblings. */
  sibling: number;
  scale: number;
}

export function spacingOf(style: Pick<MapStyle, "density" | "layout">): Spacing {
  const s = SPACING[style.density] ?? 1;
  return style.layout === "down" ? { rank: 56 * s, sibling: 22 * s, scale: s } : { rank: 64 * s, sibling: 12 * s, scale: s };
}

/** The look of a node at `depth` whose branch is `branch`. */
export function lookFor(theme: Theme, style: MapStyle, families: FontFamilies, depth: number, branch: string): NodeLook {
  const fontFamily = families[style.font] ?? FONT_STACK[style.font];
  const pad = SPACING[style.density] ?? 1;
  if (depth === 0) {
    return {
      depth,
      fontSize: 22,
      fontWeight: 650,
      lineHeight: 28,
      fontFamily,
      padX: Math.round(20 * pad),
      padY: Math.round(14 * pad),
      radius: 16,
      maxTextWidth: 300,
      imageMax: { width: 280, height: 200 },
      shape: "card",
      fill: theme.root.fill,
      stroke: theme.root.stroke ?? null,
      strokeWidth: theme.root.stroke ? 1.5 : 0,
      textColor: readableOn(theme.root.fill, theme.dark ? "#0c0e14" : theme.text, "#ffffff"),
      underline: null,
      branch,
    };
  }
  if (depth === 1) {
    const { fill: kind, shape } = theme.level1;
    const fill = kind === "solid" ? branch : kind === "soft" ? mix(branch, theme.background, theme.dark ? 0.2 : 0.14) : theme.background;
    const textColor = kind === "solid" ? readableOn(branch, theme.dark ? "#0c0e14" : "#111114", "#ffffff") : theme.text;
    return {
      depth,
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 22,
      fontFamily,
      padX: Math.round(14 * pad),
      padY: Math.round(8 * pad),
      radius: shape === "pill" ? 999 : 10,
      maxTextWidth: 240,
      imageMax: { width: 220, height: 160 },
      shape,
      fill,
      stroke: kind === "solid" ? null : branch,
      strokeWidth: kind === "solid" ? 0 : kind === "soft" ? 1.25 : 1.75,
      textColor,
      underline: null,
      branch,
    };
  }
  const shape = theme.deeper;
  return {
    depth,
    fontSize: 14,
    fontWeight: 450,
    lineHeight: 20,
    fontFamily,
    padX: shape === "underline" || shape === "plain" ? 4 : 10,
    padY: shape === "underline" ? 5 : shape === "plain" ? 3 : 6,
    radius: 8,
    maxTextWidth: 220,
    imageMax: { width: 200, height: 150 },
    shape,
    fill: shape === "card" || shape === "pill" ? mix(branch, theme.background, theme.dark ? 0.16 : 0.1) : null,
    stroke: null,
    strokeWidth: 0,
    textColor: theme.text,
    underline: shape === "underline" ? branch : null,
    branch,
  };
}

/** The width of the branch leading to a node at `depth`. */
export const edgeWidthFor = (theme: Theme, depth: number) => (depth <= 1 ? theme.edgeWidth : depth === 2 ? Math.max(1.6, theme.edgeWidth * 0.55) : 1.4);

/** A branch's colour: the node's own, else its main branch's, else the accent. */
export function branchColor(theme: Theme, style: MapStyle, mainIndex: number): string {
  if (!style.rainbow) return theme.accent;
  return theme.palette[((mainIndex % theme.palette.length) + theme.palette.length) % theme.palette.length];
}
