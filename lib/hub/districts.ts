/**
 * The island's buildings: one per part of LifeOS, where it stands, and how
 * the camera frames it.
 *
 * The island faces north (see `skyDirection`): the camera looks from the
 * south, over the harbour, across the plaza. Every building turns its front
 * to the plaza's centre, so a close-up always sees its door and its sign.
 *
 * Pure data and geometry — the scene draws it, the HUD lists it, the tests
 * check that no two buildings stand in each other.
 */

export type DistrictId =
  | "brain"
  | "today"
  | "assistant"
  | "agent"
  | "projects"
  | "relations"
  | "finance"
  | "team"
  | "settings";

export interface District {
  id: DistrictId;
  href: string;
  /** Position on the island: x (east), z (south). */
  at: readonly [number, number];
  /** Roof height, for framing. */
  height: number;
  /** Footprint radius, for framing and spacing. */
  radius: number;
  /** The "G then key" shortcut that opens it. */
  hint: string;
}

/**
 * In the order the arrow keys visit them: the landmark first, then around the
 * plaza clockwise as seen from above, starting on the left.
 */
export const DISTRICTS: readonly District[] = [
  { id: "brain", href: "/brain", at: [0, -8.2], height: 6.4, radius: 3.4, hint: "G R" },
  { id: "finance", href: "/finance", at: [8.2, -5.6], height: 8.6, radius: 1.8, hint: "G F" },
  { id: "relations", href: "/crm", at: [11.2, 0.6], height: 3.2, radius: 2.3, hint: "G C" },
  { id: "agent", href: "/agent", at: [7.6, 7.2], height: 3.4, radius: 2.1, hint: "G G" },
  { id: "settings", href: "/settings", at: [13.4, 11.4], height: 6.2, radius: 1.1, hint: "G S" },
  { id: "assistant", href: "/assistant", at: [-7.4, 7.4], height: 2.2, radius: 2.4, hint: "G A" },
  { id: "projects", href: "/projects", at: [-11.2, 0.4], height: 4.6, radius: 2.3, hint: "G P" },
  { id: "team", href: "/team", at: [-8.2, -5.8], height: 3.8, radius: 2.9, hint: "G T" },
  { id: "today", href: "/dashboard", at: [-3.7, -2.1], height: 7.2, radius: 0.8, hint: "G D" },
] as const;

export const DISTRICT_IDS = DISTRICTS.map((d) => d.id);

export function districtById(id: DistrictId): District {
  const found = DISTRICTS.find((d) => d.id === id);
  if (!found) throw new Error(`unknown district ${id}`);
  return found;
}

export function isDistrictId(v: unknown): v is DistrictId {
  return typeof v === "string" && (DISTRICT_IDS as string[]).includes(v);
}

/** The next building in visiting order, wrapping around. */
export function neighbour(id: DistrictId, step: 1 | -1): DistrictId {
  const i = DISTRICT_IDS.indexOf(id);
  return DISTRICT_IDS[(i + step + DISTRICT_IDS.length) % DISTRICT_IDS.length];
}

/**
 * The rotation (about +Y) that turns a building's front (+Z in its own frame)
 * towards the plaza's centre. The lighthouse stands on its jetty facing the
 * open sea instead — a lighthouse does not look inland.
 */
export function facing(d: Pick<District, "id" | "at">): number {
  const [x, z] = d.at;
  if (d.id === "settings") return Math.atan2(x, z);
  return Math.atan2(-x, -z);
}

export type Vec3 = [number, number, number];

export interface View {
  position: Vec3;
  target: Vec3;
}

/** Right in front of the door, where "enter" ends. */
export function doorwayView(d: District): View {
  const [x, z] = d.at;
  const f = facing(d);
  const out = d.radius + 1.1;
  return {
    position: [x + Math.sin(f) * out, 1.1, z + Math.cos(f) * out],
    target: [x + Math.sin(f) * (d.radius - 0.4), 0.9, z + Math.cos(f) * (d.radius - 0.4)],
  };
}
