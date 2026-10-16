import { describe, it, expect } from "vitest";
import { fromOutline, setCollapsed, setStyle, updateNode, type LayoutKind, type MapDoc, type Outline } from "@/lib/maps/model";
import { layoutMap, splitSides, type Layout } from "@/lib/maps/layout";
import { approxMeasurer, wrap } from "@/lib/maps/measure";
import { DEFAULT_FAMILIES, THEMES, contrast, lookFor, readableOn } from "@/lib/maps/theme";
import { toSvg } from "@/lib/maps/svg";
import { parseXml } from "@/lib/maps/formats/xml";

const m = approxMeasurer();
const opts = { families: DEFAULT_FAMILIES, measurer: m };

/** A pseudo-random tree, the same for a seed. */
function randomTree(seed: number, size: number): Outline {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const words = ["plan", "idée", "Marketing", "un objectif très important à tenir", "Q3", "budget", "équipe produit", "x", "lancer la version 2 avec les retours clients"];
  const nodes: Outline[] = [{ text: "Root", children: [] }];
  for (let i = 1; i < size; i++) {
    const parent = nodes[Math.floor(rand() * nodes.length * (rand() < 0.5 ? 0.3 : 1))];
    const n: Outline = { text: words[Math.floor(rand() * words.length)] + (rand() < 0.2 ? `\n${words[Math.floor(rand() * words.length)]}` : "") };
    if (rand() < 0.1) n.emoji = "💡";
    if (rand() < 0.08) n.note = "note";
    if (rand() < 0.05) n.image = { file: "0123456789abcdef.webp", width: 400 + Math.floor(rand() * 800), height: 300 + Math.floor(rand() * 600) };
    (parent.children ??= []).push(n);
    nodes.push(n);
  }
  return nodes[0];
}

function overlaps(layout: Layout): string[] {
  const boxes = [...layout.boxes.values()];
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) bad.push(`${a.id}/${b.id}`);
    }
  return bad;
}

describe("laying out a map", () => {
  it("never puts two ideas on top of each other, in any layout, whatever their sizes", () => {
    for (const layout of ["map", "right", "down"] as LayoutKind[]) {
      for (let seed = 1; seed <= 12; seed++) {
        const doc = fromOutline(randomTree(seed, 60 + seed * 15), { layout });
        const l = layoutMap(doc, opts);
        expect(overlaps(l), `${layout} seed ${seed}`).toEqual([]);
        expect(l.boxes.size).toBe(Object.keys(doc.nodes).length);
      }
    }
  });

  it("grows each branch away from its parent, the parent in the middle of its children", () => {
    for (const layout of ["map", "right", "down"] as LayoutKind[]) {
      const doc = fromOutline(randomTree(7, 120), { layout });
      const l = layoutMap(doc, opts);
      for (const n of Object.values(doc.nodes)) {
        const p = l.boxes.get(n.id)!;
        if (n.children.length === 0 || n.id === doc.root) continue;
        const kids = n.children.map((c) => l.boxes.get(c)!);
        for (const c of kids) {
          if (layout === "down") expect(c.y).toBeGreaterThan(p.y + p.h);
          else if (c.dir === "left") expect(c.x + c.w).toBeLessThan(p.x);
          else expect(c.x).toBeGreaterThan(p.x + p.w);
        }
        if (layout === "down") {
          // Over its children: between the first one's left and the last one's right.
          const centre = p.x + p.w / 2;
          expect(centre).toBeGreaterThanOrEqual(kids[0].x - 1);
          expect(centre).toBeLessThanOrEqual(kids[kids.length - 1].x + kids[kids.length - 1].w + 1);
        } else {
          const top = Math.min(...kids.map((c) => c.y));
          const bottom = Math.max(...kids.map((c) => c.y + c.h));
          const centre = p.y + p.h / 2;
          expect(centre).toBeGreaterThanOrEqual(top - 1);
          expect(centre).toBeLessThanOrEqual(bottom + 1);
        }
      }
    }
  });

  it("draws one branch per visible idea, from where the parent's leaves to where the child's arrives", () => {
    const doc = fromOutline(randomTree(3, 80), { layout: "right" });
    const l = layoutMap(doc, opts);
    expect(l.edges.length).toBe(l.boxes.size - 1);
    for (const e of l.edges) {
      const c = l.boxes.get(e.to)!;
      expect(e.d.startsWith("M")).toBe(true);
      // The path ends at (or, tapered, around) the child's anchor.
      expect(e.d).toContain(String(Math.round(c.in.x * 10) / 10));
    }
  });

  it("hides what is folded, and counts it on the badge", () => {
    const doc0 = fromOutline({ text: "R", children: [{ text: "A", children: [{ text: "A1", children: [{ text: "A11" }] }, { text: "A2" }] }, { text: "B" }] });
    const a = doc0.nodes[doc0.root].children[0];
    const doc = setCollapsed(doc0, [a], true);
    const l = layoutMap(doc, opts);
    expect(l.boxes.size).toBe(3);
    expect(l.boxes.get(a)!.hidden).toBe(3);
    expect(l.boxes.get(a)!.badge).toBeDefined();
  });

  it("splits the main branches so the two sides weigh the same, keeping their order and a side chosen by hand", () => {
    const doc = fromOutline({ text: "R", children: ["a", "b", "c", "d", "e"].map((t) => ({ text: t })) });
    const kids = doc.nodes[doc.root].children;
    const w = new Map(kids.map((k, i) => [k, [100, 20, 20, 20, 40][i]]));
    const { right, left } = splitSides(doc, kids, (k) => w.get(k)!);
    expect(right).toEqual([kids[0]]);
    expect(left).toEqual(kids.slice(1));
    // One branch alone grows on the right.
    const one = fromOutline({ text: "R", children: [{ text: "only" }] });
    expect(splitSides(one, one.nodes[one.root].children, () => 10).right.length).toBe(1);
    // A side chosen by hand is kept.
    const fixed = updateNode(doc, kids[0], { side: "left" });
    expect(splitSides(fixed, kids, (k) => w.get(k)!).left).toContain(kids[0]);
  });

  it("is laid out the same every time", () => {
    const doc = fromOutline(randomTree(11, 90));
    const a = layoutMap(doc, opts);
    const b = layoutMap(doc, opts);
    expect([...a.boxes.values()].map((x) => [x.id, x.x, x.y, x.w, x.h])).toEqual([...b.boxes.values()].map((x) => [x.id, x.x, x.y, x.w, x.h]));
  });
});

describe("text in a node", () => {
  it("wraps at spaces, keeps typed line breaks, cuts a word wider than the line", () => {
    const font = "400 14px sans-serif";
    const lines = wrap("Un objectif ambitieux pour cette année\nDeux", font, 120, m);
    expect(lines.at(-1)).toBe("Deux");
    for (const l of lines) expect(m.width(l, font)).toBeLessThanOrEqual(120 + 0.01);
    const long = wrap("Anticonstitutionnellement-et-plus-encore", font, 80, m);
    expect(long.length).toBeGreaterThan(1);
    expect(long.join("")).toBe("Anticonstitutionnellement-et-plus-encore");
    expect(wrap("", font, 100, m)).toEqual([""]);
  });
});

describe("themes", () => {
  it("text on any shape of any theme is readable (WCAG contrast at least 4.5:1)", () => {
    for (const theme of Object.values(THEMES)) {
      const style = setStyle(fromOutline({ text: "R" }), { theme: theme.id }).style;
      for (const color of [...theme.palette, theme.accent]) {
        for (const depth of [0, 1, 2]) {
          const look = lookFor(theme, style, DEFAULT_FAMILIES, depth, color);
          const under = look.fill ?? theme.background;
          expect(contrast(look.textColor, under), `${theme.id} depth ${depth} on ${under}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("picks the ink that reads better", () => {
    expect(readableOn("#ffffff")).toBe("#111114");
    expect(readableOn("#111111")).toBe("#ffffff");
  });
});

describe("the SVG file", () => {
  const doc: MapDoc = fromOutline({
    text: "Plan <2026> & co",
    children: [
      { text: "Idée \"forte\"", emoji: "💡", note: "pourquoi", link: "https://example.org/", image: { file: "0123456789abcdef.webp", width: 800, height: 600 } },
      { text: "B", collapsed: true, children: [{ text: "hidden" }] },
    ],
  });

  it("is well-formed, escapes what it must, carries its images and nothing that runs", () => {
    const l = layoutMap(doc, opts);
    const svg = toSvg(doc, l, { images: new Map([["0123456789abcdef.webp", "data:image/webp;base64,AAAA"]]), title: "Plan <2026>" });
    expect(() => parseXml(svg)).not.toThrow();
    expect(svg).toContain("Plan &lt;2026&gt; &amp; co");
    expect(svg).toContain("Idée &quot;forte&quot;");
    expect(svg).toContain("data:image/webp;base64,AAAA");
    expect(svg).not.toMatch(/<script|on\w+=/i);
    expect(svg).not.toContain("hidden");
  });

  it("as a thumbnail, draws bars instead of words", () => {
    const l = layoutMap(doc, opts);
    const thumb = toSvg(doc, l, { thumbnail: true });
    expect(thumb).not.toContain("Plan");
    expect(thumb.length).toBeLessThan(toSvg(doc, l).length);
  });
});
