import type { BrainCategoryId } from "@/lib/data/brain";

/**
 * What a connection between two notes means.
 *
 * A bare line between two notes says "these are related" and nothing else, so
 * the person has to reconstruct why every time. A typed connection says it:
 *
 *   advances  — one note moves the other forward (a step toward a goal)
 *   supports  — one note backs the other (a fact behind a decision)
 *   extends   — one note develops the other (a follow-up to an idea)
 *   tension   — the two pull against each other (a contradiction, a trade-off)
 *   related   — same specific subject, nothing more precise
 *
 * The first three have a direction; the pair is stored canonically (see
 * `canonicalPair`), so the direction is kept separately as `sourceId` — the
 * note the relation starts from.
 */
export const RELATION_KINDS = ["advances", "supports", "extends", "tension", "related"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const DIRECTED: ReadonlySet<RelationKind> = new Set(["advances", "supports", "extends"]);

export function isRelationKind(v: unknown): v is RelationKind {
  return typeof v === "string" && (RELATION_KINDS as readonly string[]).includes(v);
}

/** Who drew a connection. `ai` and `agent` are awaiting the person's review. */
export const LINK_ORIGINS = ["user", "suggested", "ai", "agent"] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];

export function isLinkOrigin(v: unknown): v is LinkOrigin {
  return typeof v === "string" && (LINK_ORIGINS as readonly string[]).includes(v);
}

/** Drawn by a machine and not yet kept by the person. */
export const isUnreviewed = (origin: LinkOrigin) => origin === "ai" || origin === "agent";

/** Colours for the graph and the UI — one per kind, readable on dark. */
export const RELATION_COLOR: Record<RelationKind, string> = {
  advances: "#34d399",
  supports: "#60a5fa",
  extends: "#22d3ee",
  tension: "#fb7185",
  related: "#94a3b8",
};

/**
 * How strongly a region reads as the destination of `advances` (the thing
 * moved forward) and as the evidence in `supports` (the thing that backs).
 * Used only when a directed connection carries no explicit source — one drawn
 * by hand before directions existed, or retyped by the person.
 */
const DESTINATION: Record<BrainCategoryId, number> = {
  goals: 3, ideas: 2, insights: 2, thoughts: 1, knowledge: 1, next: 0,
};
const EVIDENCE: Record<BrainCategoryId, number> = {
  knowledge: 3, insights: 2, thoughts: 1, ideas: 0, goals: 0, next: 0,
};

export interface EndLike {
  id: string;
  category: BrainCategoryId;
  createdAt: string;
}

/**
 * The note a directed relation starts from, or null for symmetric kinds.
 * An explicit source wins; otherwise it is inferred from the regions, then
 * from age (the later note builds on the earlier).
 */
export function sourceOf(kind: RelationKind, a: EndLike, b: EndLike, explicit?: string | null): string | null {
  if (!DIRECTED.has(kind)) return null;
  if (explicit && (explicit === a.id || explicit === b.id)) return explicit;

  const older = a.createdAt <= b.createdAt ? a : b;
  const newer = older === a ? b : a;
  switch (kind) {
    case "advances": {
      // The source is the step; the destination is the goal it serves.
      const da = DESTINATION[a.category];
      const db = DESTINATION[b.category];
      if (da !== db) return da < db ? a.id : b.id;
      return newer.id;
    }
    case "supports": {
      const ea = EVIDENCE[a.category];
      const eb = EVIDENCE[b.category];
      if (ea !== eb) return ea > eb ? a.id : b.id;
      return older.id;
    }
    default:
      return newer.id; // extends: the later note develops the earlier one
  }
}

/**
 * The relation as seen from one end: "out" when this note is the source
 * ("moves X forward"), "in" when it is the destination ("moved forward by X"),
 * "both" for symmetric kinds.
 */
export type Perspective = "out" | "in" | "both";

export function perspective(kind: RelationKind, selfId: string, sourceId: string | null): Perspective {
  if (!DIRECTED.has(kind) || !sourceId) return "both";
  return sourceId === selfId ? "out" : "in";
}
