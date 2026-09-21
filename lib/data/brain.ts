import {
  Target, Lightbulb, MessagesSquare, Compass, BookOpen, Sparkles, type LucideIcon,
} from "lucide-react";

/**
 * The Second Brain content model.
 *
 * Six regions, each anchored to a point on the 3D brain so the scene and the
 * UI stay in sync. The anchors are loosely anatomical on purpose: goals sit in
 * the prefrontal cortex, where planning lives; knowledge toward the back, where
 * long-term memory consolidates.
 */
export type BrainCategoryId = "goals" | "ideas" | "thoughts" | "next" | "knowledge" | "insights";

export interface BrainCategory {
  id: BrainCategoryId;
  icon: LucideIcon;
  /** Hex, drives the 3D node and the UI accents. */
  color: string;
  /** World position of the region marker, on the brain's surface. */
  anchor: [number, number, number];
  /** Pulse offset, so regions don't beat in unison. */
  phase: number;
}

/**
 * Order is the order regions appear in the UI. Goals first: everything else in
 * a second brain is meant to ladder up to them.
 */
export const categories: BrainCategory[] = [
  // Amber, deliberately outside the cyan family: the one region that should
  // read as a destination rather than as more material.
  { id: "goals", icon: Target, color: "#fbbf24", anchor: [1.12, 0.52, -0.3], phase: 0.0 },
  { id: "next", icon: Compass, color: "#34d399", anchor: [1.28, -0.08, 0.34], phase: 0.9 },
  { id: "ideas", icon: Lightbulb, color: "#22d3ee", anchor: [0.72, 0.72, 0.62], phase: 1.8 },
  { id: "thoughts", icon: MessagesSquare, color: "#38bdf8", anchor: [0.15, 1.05, 0.15], phase: 2.7 },
  { id: "knowledge", icon: BookOpen, color: "#60a5fa", anchor: [-1.0, 0.52, -0.34], phase: 3.6 },
  { id: "insights", icon: Sparkles, color: "#5eead4", anchor: [0.1, 0.18, 1.18], phase: 4.5 },
];

export type BrainItemKind = "goal" | "idea" | "thought" | "task" | "note" | "insight";

/** Each region has one natural kind; captured notes take it. */
export const kindForCategory: Record<BrainCategoryId, BrainItemKind> = {
  goals: "goal",
  ideas: "idea",
  thoughts: "thought",
  next: "task",
  knowledge: "note",
  insights: "insight",
};

export const CATEGORY_IDS = categories.map((c) => c.id) as BrainCategoryId[];

export function isCategory(v: unknown): v is BrainCategoryId {
  return typeof v === "string" && (CATEGORY_IDS as string[]).includes(v);
}

export const categoryById = (id: BrainCategoryId): BrainCategory =>
  categories.find((c) => c.id === id) ?? categories[2];

export interface BrainItem {
  id: string;
  category: BrainCategoryId;
  kind: BrainItemKind;
  title?: string;
  detail?: string;
  done?: boolean;
  ts?: string;
  ai?: boolean;
}

/**
 * Seed items for the signed-out demo only — real accounts start empty. Their
 * text lives in the i18n dictionaries (`brain.items[id]`) so the demo reads
 * natively in either language.
 */
export const seedItems: BrainItem[] = [
  // Ages give the demo a history: focus has waiting steps to rank, and
  // resurfacing has notes old enough (a week or more) to bring back.
  { id: "g1", category: "goals", kind: "goal", ts: "3w" },

  { id: "n1", category: "next", kind: "task", ts: "5d" },
  { id: "n2", category: "next", kind: "task", ts: "2d" },
  { id: "n3", category: "next", kind: "task", ts: "1w", done: true },

  { id: "i1", category: "ideas", kind: "idea", ts: "3d" },
  { id: "i2", category: "ideas", kind: "idea", ts: "3w" },
  { id: "i3", category: "ideas", kind: "idea", ts: "2w" },

  { id: "t1", category: "thoughts", kind: "thought", ts: "1w" },
  { id: "t2", category: "thoughts", kind: "thought", ts: "4w" },

  { id: "k1", category: "knowledge", kind: "note", ts: "2w" },
  { id: "k2", category: "knowledge", kind: "note", ts: "5w" },

  { id: "s1", category: "insights", kind: "insight", ts: "3w" },
  { id: "s2", category: "insights", kind: "insight", ts: "1d" },
];
