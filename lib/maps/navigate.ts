import type { MapDoc } from "./model";
import type { Box, Layout } from "./layout";

/**
 * Where an arrow key goes from an idea. The tree first — towards the
 * children goes to the child nearest in line, back towards the root goes to
 * the parent, along the branch goes to the next sibling — then, when the
 * tree has nothing that way, the nearest idea on screen in that direction.
 */

export type Arrow = "up" | "down" | "left" | "right";

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function nearestByAxis(boxes: Box[], from: Box, vertical: boolean): Box | null {
  const c = centre(from);
  let best: Box | null = null;
  let bestD = Infinity;
  for (const b of boxes) {
    const d = Math.abs(vertical ? centre(b).x - c.x : centre(b).y - c.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function spatial(layout: Layout, from: Box, arrow: Arrow): string | null {
  const c = centre(from);
  let best: string | null = null;
  let bestScore = Infinity;
  for (const b of layout.boxes.values()) {
    if (b.id === from.id) continue;
    const p = centre(b);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const main = arrow === "left" ? -dx : arrow === "right" ? dx : arrow === "up" ? -dy : dy;
    const side = arrow === "left" || arrow === "right" ? Math.abs(dy) : Math.abs(dx);
    if (main <= 1) continue;
    const score = main + side * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = b.id;
    }
  }
  return best;
}

export function neighbour(doc: MapDoc, layout: Layout, parents: Map<string, string>, from: string, arrow: Arrow): string | null {
  const box = layout.boxes.get(from);
  if (!box) return null;
  const node = doc.nodes[from];
  const kids = (node.collapsed ? [] : node.children).map((k) => layout.boxes.get(k)).filter((b): b is Box => !!b);
  const parent = parents.get(from);

  // Which way this idea's children grow, and which way its parent is.
  const grow: Arrow | "both" = box.dir === "both" ? "both" : box.dir === "down" ? "down" : box.dir === "left" ? "left" : "right";
  const back: Arrow | null = parent ? (grow === "down" ? "up" : grow === "left" ? "right" : grow === "right" ? "left" : null) : null;

  if (grow === "both" && (arrow === "left" || arrow === "right")) {
    const side = kids.filter((k) => k.dir === arrow);
    const pick = nearestByAxis(side, box, false);
    if (pick) return pick.id;
  } else if (arrow === grow) {
    const pick = nearestByAxis(kids, box, grow === "down");
    if (pick) return pick.id;
  } else if (arrow === back && parent) {
    return parent;
  } else if (parent) {
    // Along the branch: the previous or next sibling on the same side, in screen order.
    const along = grow === "down" ? (arrow === "left" ? -1 : arrow === "right" ? 1 : 0) : arrow === "up" ? -1 : arrow === "down" ? 1 : 0;
    if (along) {
      const siblings = doc.nodes[parent].children
        .map((k) => layout.boxes.get(k))
        .filter((b): b is Box => !!b && b.dir === box.dir)
        .sort((a, b) => (grow === "down" ? a.x - b.x : a.y - b.y));
      const i = siblings.findIndex((b) => b.id === from);
      const next = siblings[i + along];
      if (next) return next.id;
    }
  }
  return spatial(layout, box, arrow);
}
