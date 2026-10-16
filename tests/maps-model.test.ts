import { describe, it, expect } from "vitest";
import {
  LIMITS,
  MapLimitError,
  addChild,
  addSibling,
  cleanEmoji,
  cleanUrl,
  duplicate,
  fromOutline,
  indent,
  insertOutlines,
  moveNode,
  newDoc,
  nodeCount,
  outdent,
  parentOf,
  parseDoc,
  removeNodes,
  reorder,
  reveal,
  search,
  setCollapsed,
  settleProposals,
  showLevels,
  subtree,
  toOutline,
  updateNode,
  visibleIds,
  type MapDoc,
} from "@/lib/maps/model";

/** Predictable ids, never the same twice across generators: g1_1, g1_2… */
let generators = 0;
const ids = () => {
  const prefix = `g${++generators}_`;
  let n = 0;
  return () => `${prefix}${++n}`;
};

/** root ─ a ─ a1, a2 ; b ─ b1 ; c */
function sample(): MapDoc {
  return fromOutline(
    { text: "Root", children: [{ text: "A", children: [{ text: "A1" }, { text: "A2" }] }, { text: "B", children: [{ text: "B1" }] }, { text: "C" }] },
    {},
    ids()
  );
}
const byText = (doc: MapDoc, text: string) => Object.values(doc.nodes).find((n) => n.text === text)!.id;
const texts = (doc: MapDoc, id: string) => doc.nodes[id].children.map((c) => doc.nodes[c].text);

describe("a map document, read from anywhere", () => {
  it("keeps a valid tree as it is", () => {
    const doc = sample();
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("refuses what is not a map", () => {
    for (const bad of [null, 1, "x", {}, { version: 2, root: "a", nodes: { a: { text: "" } } }, { version: 1, root: "missing", nodes: {} }, { version: 1, root: "../x", nodes: { "../x": { text: "" } } }]) {
      expect(parseDoc(bad)).toBeNull();
    }
  });

  it("keeps one parent per node, breaks cycles, drops the unknown and the unreachable", () => {
    const doc = parseDoc({
      version: 1,
      root: "r",
      nodes: {
        r: { text: "R", children: ["a", "b", "ghost", "a"] },
        a: { text: "A", children: ["c", "r"] },
        b: { text: "B", children: ["c"] },
        c: { text: "C", children: ["a"] },
        lost: { text: "unreachable", children: [] },
      },
    })!;
    expect(Object.keys(doc.nodes).sort()).toEqual(["a", "b", "c", "r"]);
    expect(doc.nodes.r.children).toEqual(["a", "b"]);
    expect(doc.nodes.a.children).toEqual(["c"]);
    expect(doc.nodes.b.children).toEqual([]);
    expect(doc.nodes.c.children).toEqual([]);
  });

  it("caps the number of ideas and the depth", () => {
    const nodes: Record<string, unknown> = { r: { text: "R", children: [] as string[] } };
    for (let i = 0; i < LIMITS.nodes + 50; i++) {
      nodes[`x${i}`] = { text: `${i}`, children: [] };
      (nodes.r as { children: string[] }).children.push(`x${i}`);
    }
    expect(nodeCount(parseDoc({ version: 1, root: "r", nodes })!)).toBe(LIMITS.nodes);

    const chain: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) chain[`d${i}`] = { text: `${i}`, children: i < 79 ? [`d${i + 1}`] : [] };
    expect(nodeCount(parseDoc({ version: 1, root: "d0", nodes: chain })!)).toBe(LIMITS.depth + 1);
  });

  it("cleans every field: control characters, links that would run code, a word passed off as an emoji", () => {
    const doc = parseDoc({
      version: 1,
      root: "r",
      nodes: {
        r: { text: "Root\u0007 name", children: ["a"], side: "left" },
        a: {
          text: "A",
          children: [],
          link: "javascript:alert(1)",
          emoji: "hello",
          color: "red",
          image: { file: "../../etc/passwd.png", width: 10, height: 10 },
          side: "left",
          collapsed: "yes",
          noteId: "<script>",
        },
      },
      style: { theme: "nope", layout: "down", rainbow: "maybe" },
    })!;
    expect(doc.nodes.r.text).toBe("Root name");
    expect(doc.nodes.r.side).toBeUndefined();
    const a = doc.nodes.a;
    expect(a).toEqual({ id: "a", text: "A", children: [], side: "left" });
    expect(doc.style).toMatchObject({ theme: "daylight", layout: "down", rainbow: true });
  });

  it("only links that open a page or a mail", () => {
    expect(cleanUrl("https://lifeos.app/x?y=1#z")).toBe("https://lifeos.app/x?y=1#z");
    expect(cleanUrl("lifeos.app/notes")).toBe("https://lifeos.app/notes");
    expect(cleanUrl("mailto:camille@example.com")).toBe("mailto:camille@example.com");
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "just words", "https://", ""]) {
      expect(cleanUrl(bad), bad).toBeUndefined();
    }
  });

  it("an emoji is one emoji", () => {
    for (const ok of ["💡", "✅", "👩‍💻", "🇫🇷", "1️⃣", "❤️"]) expect(cleanEmoji(ok), ok).toBe(ok);
    for (const bad of ["a", "💡💡", "ok 💡", "", "😀".repeat(9)]) expect(cleanEmoji(bad), bad).toBeUndefined();
  });
});

describe("changing a map", () => {
  it("adds a child (unfolding the parent) and siblings after or before", () => {
    const start = sample();
    let doc = setCollapsed(start, [byText(start, "A")], true);
    const a = byText(doc, "A");
    expect(doc.nodes[a].collapsed).toBe(true);
    const made = addChild(doc, a, "A3", ids());
    doc = made.doc;
    expect(doc.nodes[a].collapsed).toBeUndefined();
    expect(texts(doc, a)).toEqual(["A1", "A2", "A3"]);
    doc = addSibling(doc, byText(doc, "A1"), "after A1", false, ids()).doc;
    doc = addSibling(doc, byText(doc, "A1"), "before A1", true, ids()).doc;
    expect(texts(doc, a)).toEqual(["before A1", "A1", "after A1", "A2", "A3"]);
    // On the root, a sibling is a child.
    const r = addSibling(doc, doc.root, "new branch", false, ids());
    expect(parentOf(r.doc, r.id)).toBe(doc.root);
  });

  it("removes a branch with everything under it, never the root, and says what to select next", () => {
    const doc = sample();
    const { doc: d1, next } = removeNodes(doc, [byText(doc, "A")]);
    expect(Object.values(d1.nodes).map((n) => n.text).sort()).toEqual(["B", "B1", "C", "Root"]);
    expect(next).toBe(byText(doc, "B"));
    // The last child: the previous sibling is next.
    expect(removeNodes(doc, [byText(doc, "C")]).next).toBe(byText(doc, "B"));
    // An only child: the parent.
    expect(removeNodes(doc, [byText(doc, "B1")]).next).toBe(byText(doc, "B"));
    expect(removeNodes(doc, [doc.root]).doc).toBe(doc);
  });

  it("moves a branch anywhere but into itself", () => {
    const doc = sample();
    const a = byText(doc, "A");
    const b = byText(doc, "B");
    expect(moveNode(doc, a, byText(doc, "A1"), 0)).toBe(doc);
    expect(moveNode(doc, doc.root, b, 0)).toBe(doc);
    const moved = moveNode(doc, a, b, 1);
    expect(texts(moved, b)).toEqual(["B1", "A"]);
    expect(texts(moved, moved.root)).toEqual(["B", "C"]);
    // Within the same parent, the index counts the children before the move.
    expect(texts(moveNode(doc, a, doc.root, 3), doc.root)).toEqual(["B", "C", "A"]);
    expect(texts(moveNode(doc, byText(doc, "C"), doc.root, 0), doc.root)).toEqual(["C", "A", "B"]);
  });

  it("indents, outdents and reorders like an outliner", () => {
    const doc = sample();
    const b = byText(doc, "B");
    const indented = indent(doc, b);
    expect(texts(indented, byText(doc, "A"))).toEqual(["A1", "A2", "B"]);
    expect(texts(outdent(indented, b), indented.root)).toEqual(["A", "B", "C"]);
    expect(indent(doc, byText(doc, "A"))).toBe(doc); // nothing above it
    expect(texts(reorder(doc, b, -1), doc.root)).toEqual(["B", "A", "C"]);
    expect(reorder(doc, byText(doc, "A"), -1)).toBe(doc);
  });

  it("folds only what has something under it; shows levels; reveals a hidden idea", () => {
    const doc = sample();
    expect(setCollapsed(doc, [byText(doc, "C")], true)).toBe(doc);
    const one = showLevels(doc, 1);
    expect(visibleIds(one).map((i) => one.nodes[i].text)).toEqual(["Root", "A", "B", "C"]);
    const back = reveal(one, byText(doc, "A2"));
    expect(visibleIds(back).map((i) => back.nodes[i].text)).toContain("A2");
  });

  it("duplicates a branch with new ids, just after it", () => {
    const doc = sample();
    const { doc: d, id } = duplicate(doc, byText(doc, "A"), ids());
    expect(texts(d, d.root)).toEqual(["A", "A", "B", "C"]);
    expect(id).not.toBe(byText(doc, "A"));
    expect(subtree(d, id).map((x) => d.nodes[x].text)).toEqual(["A", "A1", "A2"]);
  });

  it("an edit makes an AI proposal the person's; proposals are accepted or set aside together", () => {
    const start = sample();
    let doc = insertOutlines(start, byText(start, "C"), [{ text: "idea 1", ai: true }, { text: "idea 2", ai: true }], undefined, ids()).doc;
    const [p1, p2] = doc.nodes[byText(doc, "C")].children;
    expect(doc.nodes[p1].ai).toBe(true);
    expect(updateNode(doc, p1, { text: "my idea" }).nodes[p1].ai).toBeUndefined();
    expect(updateNode(doc, p1, { collapsed: true }).nodes[p1].ai).toBe(true);
    const accepted = settleProposals(doc, [p1, p2], true);
    expect(accepted.nodes[p1].ai).toBeUndefined();
    doc = settleProposals(doc, [p1, p2], false);
    expect(doc.nodes[p1]).toBeUndefined();
  });

  it("never grows past the limit", () => {
    const doc = newDoc("Root", {}, ids());
    const many = Array.from({ length: LIMITS.nodes }, (_, i) => ({ text: `${i}` }));
    expect(() => insertOutlines(doc, doc.root, many)).toThrow(MapLimitError);
  });

  it("updates fields through the same rules as a saved document", () => {
    const doc = sample();
    const a = byText(doc, "A");
    const d = updateNode(doc, a, { link: "example.org", emoji: "🔥", color: "#AABBCC", note: "  " });
    expect(d.nodes[a]).toMatchObject({ link: "https://example.org/", emoji: "🔥", color: "#aabbcc" });
    expect(d.nodes[a].note).toBeUndefined();
    expect(updateNode(d, a, { link: "", emoji: "" }).nodes[a].link).toBeUndefined();
    // A side is only for the root's branches.
    expect(updateNode(doc, byText(doc, "A1"), { side: "left" }).nodes[byText(doc, "A1")].side).toBeUndefined();
    expect(updateNode(doc, a, { side: "left" }).nodes[a].side).toBe("left");
  });

  it("finds ideas without minding accents or case, in tree order", () => {
    const doc = fromOutline({ text: "Projet", children: [{ text: "Été à Lyon", note: "réserver" }, { text: "Hiver" }, { text: "Marché", children: [{ text: "ete" }] }] }, {}, ids());
    expect(search(doc, "ETE").map((i) => doc.nodes[i].text)).toEqual(["Été à Lyon", "ete"]);
    expect(search(doc, "reserver lyon").map((i) => doc.nodes[i].text)).toEqual(["Été à Lyon"]);
    expect(search(doc, "   ")).toEqual([]);
  });

  it("an outline goes in and comes out the same", () => {
    const outline = {
      text: "Root",
      children: [
        { text: "A", emoji: "💡", note: "why", link: "https://example.org/", side: "left" as const, children: [{ text: "A1", color: "#112233" }] },
        { text: "B", collapsed: true, children: [{ text: "B1" }] },
      ],
    };
    expect(toOutline(fromOutline(outline, {}, ids()))).toEqual(outline);
  });
});
