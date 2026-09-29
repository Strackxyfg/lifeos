import type { DistrictId } from "./districts";

/**
 * What is inside the buildings — seen through their windows.
 *
 * Each building that has glass has rooms, and each room its furniture and
 * its light: a café's amber, the studio's gold, the team club's violet, the
 * brain's blue… — one hue per building, so the island at night reads as a
 * town of different places, not one warm grid of windows.
 *
 * The scale is the island's: a person is 0.46 units tall (1 unit ≈ 3.9 m),
 * so a desk stands 0.19 high, a chair's seat 0.115.
 *
 * Pure data, in each building's own coordinates (its front faces +Z): the
 * scene builds it; the tests check that everything stands inside its room,
 * on its floor, and that nothing stands in anything else.
 */

export type Kind =
  | "table"
  | "roundTable"
  | "chair"
  | "stool"
  | "desk"
  | "sofa"
  | "armchair"
  | "counter"
  | "shelf"
  | "plant"
  | "pendant"
  | "rack"
  | "board"
  | "screen"
  | "rug"
  | "floorLamp"
  | "bench"
  | "machine"
  | "model"
  | "panel";

export interface Item {
  kind: Kind;
  /** Where it stands: x, floor height, z. Wall-hung things: their centre's height. */
  at: [number, number, number];
  /** Turn about the vertical, radians; 0 faces +Z. */
  rot?: number;
  /** Width (x) and depth (z) before the turn; defaults per kind. */
  size?: [number, number];
  /** Its main colour. */
  color?: string;
}

export interface Room {
  /** Inside faces of its walls, its floor and its ceiling. */
  min: [number, number, number];
  max: [number, number, number];
  items: Item[];
}

export interface Interior {
  /** The colour of the building's light. */
  light: string;
  /** How strong its lamps are, relative to a small room's (a great round hall needs more). */
  power?: number;
  /** Where its lights hang (one per room on capable devices; the first alone otherwise). */
  lamps: [number, number, number][];
  rooms: Room[];
}

/** Footprints before turning, width × depth, and heights — the scene builds to these. */
export const DIMENSIONS: Record<Kind, { w: number; d: number; h: number; free?: boolean }> = {
  table: { w: 0.3, d: 0.2, h: 0.19 },
  roundTable: { w: 0.2, d: 0.2, h: 0.19 },
  chair: { w: 0.12, d: 0.12, h: 0.22 },
  stool: { w: 0.09, d: 0.09, h: 0.18 },
  desk: { w: 0.34, d: 0.18, h: 0.19 },
  sofa: { w: 0.5, d: 0.2, h: 0.2 },
  armchair: { w: 0.2, d: 0.2, h: 0.2 },
  counter: { w: 1.4, d: 0.18, h: 0.28 },
  shelf: { w: 0.6, d: 0.08, h: 0.5 },
  plant: { w: 0.12, d: 0.12, h: 0.32 },
  pendant: { w: 0.12, d: 0.12, h: 0.1, free: true },
  rack: { w: 0.16, d: 0.16, h: 0.5 },
  board: { w: 0.6, d: 0.02, h: 0.3, free: true },
  screen: { w: 0.5, d: 0.02, h: 0.28, free: true },
  rug: { w: 0.6, d: 0.4, h: 0.004, free: true },
  floorLamp: { w: 0.08, d: 0.08, h: 0.4 },
  bench: { w: 0.4, d: 0.12, h: 0.12 },
  machine: { w: 0.24, d: 0.2, h: 0.24 },
  model: { w: 0.44, d: 0.3, h: 0.22 },
  /** A ceiling light panel; `at` is on the ceiling. */
  panel: { w: 0.6, d: 0.12, h: 0.006, free: true },
};

/** Its footprint once turned: [minX, maxX, minZ, maxZ]. */
export function footprint(item: Item): [number, number, number, number] {
  const dim = DIMENSIONS[item.kind];
  const [w, d] = item.size ?? [dim.w, dim.d];
  const r = item.rot ?? 0;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const hw = (w * c + d * s) / 2;
  const hd = (w * s + d * c) / 2;
  return [item.at[0] - hw, item.at[0] + hw, item.at[2] - hd, item.at[2] + hd];
}

/* ── Helpers to set a room ─────────────────────────────────────────── */

const chair = (x: number, y: number, z: number, rot: number, color?: string): Item => ({ kind: "chair", at: [x, y, z], rot, color });

/** A table and its chairs, on both long sides (or round it). */
function tableSet(x: number, y: number, z: number, opts: { kind?: "table" | "roundTable"; chairs?: number; w?: number; d?: number; color?: string; chairColor?: string } = {}): Item[] {
  const kind = opts.kind ?? "table";
  const items: Item[] = [];
  if (kind === "roundTable") {
    items.push({ kind, at: [x, y, z], color: opts.color });
    const n = opts.chairs ?? 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 2;
      // A chair faces the table: its front (+Z when unturned) points at it.
      items.push(chair(x + Math.cos(a) * 0.19, y, z + Math.sin(a) * 0.19, Math.atan2(-Math.cos(a), -Math.sin(a)), opts.chairColor));
    }
    return items;
  }
  const w = opts.w ?? DIMENSIONS.table.w;
  const d = opts.d ?? DIMENSIONS.table.d;
  items.push({ kind, at: [x, y, z], size: [w, d], color: opts.color });
  const perSide = Math.max(1, Math.round((opts.chairs ?? 4) / 2));
  for (let i = 0; i < perSide; i++) {
    const cx = x - w / 2 + (w * (i + 0.5)) / perSide;
    items.push(chair(cx, y, z - d / 2 - 0.08, 0, opts.chairColor));
    items.push(chair(cx, y, z + d / 2 + 0.08, Math.PI, opts.chairColor));
  }
  return items;
}

/** A desk against nothing in particular, its chair behind it, its screen on it. */
function workstation(x: number, y: number, z: number, rot: number, color?: string): Item[] {
  // The chair sits on the desk's back side (−Z unturned), facing the desk.
  const back = 0.16;
  return [
    { kind: "desk", at: [x, y, z], rot, color },
    chair(x - Math.sin(rot) * back, y, z - Math.cos(rot) * back, rot, "#2b2f36"),
  ];
}

/* ── The buildings ─────────────────────────────────────────────────── */

const WOOD = "#9a6f4c";
const OAK = "#b98b5e";
const WALNUT = "#5e3f2b";
const BLACK = "#24262b";
const WHITE = "#e9e6df";
const FABRIC_GREY = "#8c8f94";

/** The café (assistant): a bar at the back, small round tables, pendants over the counter. */
function cafe(): Interior {
  const y = 0;
  const items: Item[] = [
    { kind: "counter", at: [0.45, y, -1.33], size: [1.5, 0.18], color: WALNUT },
    { kind: "machine", at: [0.95, 0.28, -1.36], color: "#b9bcc0" },
    { kind: "shelf", at: [0.45, y, -1.5], size: [1.5, 0.06], color: WALNUT },
    { kind: "stool", at: [-0.05, y, -1.1] },
    { kind: "stool", at: [0.45, y, -1.1] },
    { kind: "stool", at: [0.95, y, -1.1] },
    ...tableSet(-1.25, y, -0.95, { kind: "roundTable", chairs: 2, color: "#d9d4ca", chairColor: WOOD }),
    ...tableSet(-1.25, y, 0.15, { kind: "roundTable", chairs: 2, color: "#d9d4ca", chairColor: WOOD }),
    ...tableSet(-0.3, y, 0.2, { kind: "roundTable", chairs: 3, color: "#d9d4ca", chairColor: WOOD }),
    ...tableSet(0.85, y, 0.2, { kind: "roundTable", chairs: 3, color: "#d9d4ca", chairColor: WOOD }),
    { kind: "plant", at: [-1.55, y, -1.42] },
    { kind: "plant", at: [1.55, y, 0.5] },
    { kind: "board", at: [-0.9, 0.9, -1.53], size: [0.5, 0.02], color: "#23302a" },
    { kind: "pendant", at: [0.05, 1.05, -1.2] },
    { kind: "pendant", at: [0.45, 1.05, -1.2] },
    { kind: "pendant", at: [0.85, 1.05, -1.2] },
    { kind: "pendant", at: [-1.25, 1.1, -0.95] },
    { kind: "pendant", at: [-1.25, 1.1, 0.15] },
  ];
  return {
    light: "#ffad5c",
    lamps: [[0.1, 1.2, -0.3]],
    rooms: [{ min: [-1.7, 0, -1.55], max: [1.7, 1.58, 0.65], items }],
  };
}

/** The team club: long shared tables, a sofa corner, a whiteboard; desks upstairs behind the band of glass. */
function club(): Interior {
  const ground: Item[] = [
    ...tableSet(-1.1, 0, -0.55, { w: 1.0, d: 0.22, chairs: 8, color: OAK, chairColor: BLACK }),
    ...tableSet(-1.1, 0, 0.55, { w: 1.0, d: 0.22, chairs: 8, color: OAK, chairColor: BLACK }),
    { kind: "rug", at: [1.35, 0, 0.1], size: [1.0, 0.8], color: "#6d5a8c" },
    { kind: "sofa", at: [1.35, 0, -0.35], color: "#4b4f7a" },
    { kind: "armchair", at: [0.8, 0, 0.35], rot: Math.PI / 2, color: "#b7a6d6" },
    { kind: "armchair", at: [1.9, 0, 0.35], rot: -Math.PI / 2, color: "#b7a6d6" },
    { kind: "table", at: [1.35, 0, 0.2], size: [0.3, 0.16], color: WALNUT },
    { kind: "board", at: [-1.1, 0.95, -1.48], size: [1.2, 0.02], color: "#f4f4f1" },
    { kind: "screen", at: [1.35, 0.95, -1.48], size: [0.8, 0.02] },
    { kind: "plant", at: [-2.25, 0, -1.35] },
    { kind: "plant", at: [2.25, 0, -1.35] },
    { kind: "plant", at: [0.35, 0, -1.3] },
    { kind: "pendant", at: [-1.4, 1.5, -0.55] },
    { kind: "pendant", at: [-0.8, 1.5, -0.55] },
    { kind: "pendant", at: [-1.4, 1.5, 0.55] },
    { kind: "pendant", at: [-0.8, 1.5, 0.55] },
  ];
  const upper: Item[] = [
    ...workstation(-1.5, 2.0, -0.15, Math.PI),
    ...workstation(-0.5, 2.0, -0.15, Math.PI),
    ...workstation(0.5, 2.0, -0.15, Math.PI),
    ...workstation(1.5, 2.0, -0.15, Math.PI),
    ...workstation(-1.0, 2.0, -1.1, 0),
    ...workstation(1.0, 2.0, -1.1, 0),
    { kind: "plant", at: [-1.95, 2.0, 0.5] },
    { kind: "plant", at: [1.95, 2.0, 0.5] },
  ];
  return {
    light: "#a98bff",
    lamps: [
      [-0.4, 1.55, 0.2],
      [0, 3.05, -0.4],
    ],
    rooms: [
      { min: [-2.4, 0, -1.5], max: [2.4, 1.9, 1.5], items: ground },
      { min: [-2.1, 2.0, -1.5], max: [2.1, 3.3, 0.7], items: upper },
    ],
  };
}

/** The studio (projects): a model on the big table, drafting desks; screens upstairs. */
function studio(): Interior {
  const ground: Item[] = [
    { kind: "table", at: [-0.25, 0, -0.1], size: [0.8, 0.5], color: OAK },
    { kind: "model", at: [-0.25, 0.19, -0.1], color: WHITE },
    { kind: "stool", at: [-0.25, 0, 0.3] },
    { kind: "stool", at: [-0.8, 0, -0.1] },
    ...workstation(1.15, 0, -0.75, Math.PI / 2, WHITE),
    ...workstation(1.15, 0, 0.35, Math.PI / 2, WHITE),
    { kind: "shelf", at: [-1.2, 0, -1.12], size: [0.7, 0.08], color: OAK },
    { kind: "plant", at: [-1.45, 0, 0.9] },
    { kind: "pendant", at: [-0.45, 1.0, -0.1] },
    { kind: "pendant", at: [-0.05, 1.0, -0.1] },
  ];
  const upper: Item[] = [
    ...workstation(-1.1, 1.45, 0.45, Math.PI, WHITE),
    ...workstation(-0.35, 1.45, 0.45, Math.PI, WHITE),
    ...workstation(0.4, 1.45, 0.45, Math.PI, WHITE),
    ...workstation(-0.7, 1.45, -0.7, 0, WHITE),
    ...workstation(0.35, 1.45, -0.7, 0, WHITE),
    { kind: "board", at: [0, 1.95, -1.18], size: [1.2, 0.02], color: "#d8c9a8" },
    { kind: "plant", at: [1.4, 1.45, -1.0] },
    { kind: "plant", at: [1.4, 1.45, 0.95] },
  ];
  return {
    light: "#ffd35a",
    lamps: [
      [0, 1.0, 0.1],
      [0, 2.1, 0],
    ],
    rooms: [
      { min: [-1.6, 0, -1.2], max: [1.6, 1.35, 1.2], items: ground },
      { min: [-1.6, 1.45, -1.2], max: [1.6, 2.4, 1.2], items: upper },
    ],
  };
}

/** The finance tower: a banking hall in the podium; open-plan floors up the tower, round a lift core. */
function bank(): Interior {
  const hall: Item[] = [
    { kind: "counter", at: [0, 0, -1.0], size: [1.8, 0.2], color: "#e4e0d7" },
    { kind: "screen", at: [0, 0.72, -1.38], size: [1.2, 0.02] },
    { kind: "bench", at: [-0.9, 0, 0.55], color: WALNUT },
    { kind: "bench", at: [0.9, 0, 0.55], color: WALNUT },
    { kind: "plant", at: [-1.35, 0, 1.2] },
    { kind: "plant", at: [1.35, 0, 1.2] },
    { kind: "pendant", at: [-0.5, 0.85, -0.2] },
    { kind: "pendant", at: [0.5, 0.85, -0.2] },
  ];
  const rooms: Room[] = [{ min: [-1.5, 0, -1.4], max: [1.5, 1.1, 1.4], items: hall }];
  // Office floors: the slab tops of the tower's bands.
  for (let i = 1; i <= 6; i++) {
    const y = 1.6 + i * 0.8 + 0.035;
    rooms.push({
      min: [-1.1, y, -1.1],
      max: [1.1, y + 0.73, 1.1],
      items: [
        ...workstation(0, y, 0.7, Math.PI, WHITE),
        ...workstation(0, y, -0.7, 0, WHITE),
        ...workstation(0.7, y, 0, -Math.PI / 2, WHITE),
        ...workstation(-0.7, y, 0, Math.PI / 2, WHITE),
        { kind: "plant", at: [0.9, y, 0.9] },
        { kind: "panel", at: [0, y + 0.72, 0.62], size: [0.9, 0.1] },
        { kind: "panel", at: [0, y + 0.72, -0.62], size: [0.9, 0.1] },
        { kind: "panel", at: [0.62, y + 0.72, 0], size: [0.1, 0.9] },
        { kind: "panel", at: [-0.62, y + 0.72, 0], size: [0.1, 0.9] },
      ],
    });
  }
  // One lamp for the hall; the tower's floors are lit by their ceiling panels
  // (a single light up the tower would make one floor a hot spot).
  return {
    light: "#8ff0c4",
    lamps: [[0, 0.8, 0.1]],
    rooms,
  };
}

/** Relations: a lounge in one pavilion, a meeting room in the other, a small reception between. */
function pavilions(): Interior {
  const lounge: Item[] = [
    { kind: "rug", at: [-1.3, 0, 0.1], size: [0.9, 0.7], color: "#b56a5a" },
    { kind: "armchair", at: [-1.62, 0, 0.1], rot: Math.PI / 2, color: "#d8b39a" },
    { kind: "armchair", at: [-0.98, 0, 0.1], rot: -Math.PI / 2, color: "#d8b39a" },
    { kind: "table", at: [-1.3, 0, 0.1], size: [0.26, 0.2], color: WALNUT },
    { kind: "shelf", at: [-1.3, 0, -0.9], size: [1.1, 0.08], color: WALNUT },
    { kind: "floorLamp", at: [-1.85, 0, -0.55] },
    { kind: "plant", at: [-0.75, 0, -0.75] },
    { kind: "pendant", at: [-1.3, 1.9, 0.1] },
  ];
  const meeting: Item[] = [
    ...tableSet(1.3, 0, 0.05, { w: 0.62, d: 0.26, chairs: 6, color: OAK, chairColor: "#3a3f4a" }),
    { kind: "screen", at: [1.3, 0.8, -0.98], size: [0.8, 0.02] },
    { kind: "plant", at: [1.85, 0, 0.85] },
    { kind: "pendant", at: [1.3, 1.9, 0.05] },
  ];
  const reception: Item[] = [
    { kind: "counter", at: [0, 0, -0.35], size: [0.6, 0.14], color: "#e4e0d7" },
    { kind: "plant", at: [-0.32, 0, 0.1] },
  ];
  const bridge: Item[] = [{ kind: "bench", at: [0, 1.62, -0.05], color: WALNUT }];
  return {
    light: "#ff9a86",
    lamps: [
      [-1.3, 1.6, 0.2],
      [1.3, 1.6, 0.2],
    ],
    rooms: [
      { min: [-2.0, 0, -1.0], max: [-0.6, 2.5, 1.0], items: lounge },
      { min: [0.6, 0, -1.0], max: [2.0, 2.8, 1.0], items: meeting },
      { min: [-0.46, 0, -0.56], max: [0.46, 1.4, 0.26], items: reception },
      { min: [-0.46, 1.62, -0.16], max: [0.46, 2.22, 0.76], items: bridge },
    ],
  };
}

/** The agent's workshop: server racks blinking down one side, a workbench with its arm, a printer. */
function atelier(): Interior {
  const y = 0.12;
  const items: Item[] = [
    { kind: "rack", at: [-0.78, y, -1.05], color: "#1d2127" },
    { kind: "rack", at: [-0.78, y, -0.8], color: "#1d2127" },
    { kind: "rack", at: [-0.78, y, -0.55], color: "#1d2127" },
    { kind: "rack", at: [-0.78, y, -0.3], color: "#1d2127" },
    { kind: "table", at: [0.62, y, -0.55], size: [0.42, 0.22], color: "#8b8f96" },
    { kind: "machine", at: [0.62, y + 0.19, -0.6], size: [0.14, 0.14], color: "#f0b429" },
    ...workstation(0.55, y, 0.45, Math.PI, "#8b8f96"),
    { kind: "machine", at: [-0.62, y, 0.55], size: [0.22, 0.22], color: "#e9e6df" },
    { kind: "pendant", at: [0, 1.05, -0.4] },
    { kind: "pendant", at: [0, 1.05, 0.5] },
  ];
  return {
    light: "#5ad8ff",
    lamps: [[0, 0.95, 0.2]],
    rooms: [{ min: [-1.0, y, -1.45], max: [1.0, 1.4, 1.45], items }],
  };
}

/** The second brain: a round reading room under the dome — shelves round the back, tables at the front. */
function rotunda(): Interior {
  const y = 0.24;
  const items: Item[] = [
    { kind: "roundTable", at: [0, y, -0.2], size: [0.7, 0.7], color: "#e4e0d7" },
    { kind: "rug", at: [0, y, -0.2], size: [1.5, 1.5], color: "#3d4f7c" },
  ];
  // Bookshelves on an arc behind the centre desk (−Z), each turned to face it.
  for (let i = 0; i < 9; i++) {
    const t = ((i / 8) * 2 - 1) * ((70 * Math.PI) / 180);
    const r = 2.55;
    items.push({ kind: "shelf", at: [Math.sin(t) * r, y, -Math.cos(t) * r], rot: -t, size: [0.62, 0.08], color: WALNUT });
  }
  items.push(...tableSet(-1.45, y, 1.15, { w: 0.5, d: 0.22, chairs: 4, color: OAK, chairColor: "#2f3d63" }));
  items.push(...tableSet(1.45, y, 1.15, { w: 0.5, d: 0.22, chairs: 4, color: OAK, chairColor: "#2f3d63" }));
  items.push({ kind: "armchair", at: [-1.75, y, -0.2], rot: Math.PI / 2, color: FABRIC_GREY });
  items.push({ kind: "armchair", at: [1.75, y, -0.2], rot: -Math.PI / 2, color: FABRIC_GREY });
  items.push({ kind: "plant", at: [-0.95, y, 2.25] }, { kind: "plant", at: [0.95, y, 2.25] });
  items.push({ kind: "pendant", at: [-1.45, 1.9, 1.15] }, { kind: "pendant", at: [1.45, 1.9, 1.15] });
  return {
    light: "#7ea6ff",
    power: 2.6,
    lamps: [
      [0, 1.85, 0.9],
      [0, 1.85, -1.4],
    ],
    // The room is round (radius 2.95): the test checks items against the circle.
    rooms: [{ min: [-2.95, y, -2.95], max: [2.95, 2.34, 2.95], items }],
  };
}

export const INTERIORS: Partial<Record<DistrictId, Interior>> = {
  assistant: cafe(),
  team: club(),
  projects: studio(),
  finance: bank(),
  relations: pavilions(),
  agent: atelier(),
  brain: rotunda(),
};

/** Round rooms: items must also sit within this radius of the room's centre. */
export const ROUND_ROOMS: Partial<Record<DistrictId, number>> = { brain: 2.95 };
