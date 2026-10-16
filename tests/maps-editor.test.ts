import { describe, expect, it } from "vitest";
import { addChild, fromOutline, nodeCount, parseDoc, updateNode, type MapDoc } from "@/lib/maps/model";
import { initialState, reduce } from "@/lib/maps/history";
import { parseIdeas, suggestInput, suggestMessages, MAX_IDEAS } from "@/lib/maps/suggest";
import { jpegToPdf } from "@/lib/maps/pdf";
import { imageInfo } from "@/lib/maps/image";
import { templates } from "@/lib/maps/templates";
import { outlineFromNote } from "@/lib/maps/from-note";
import { layoutMap } from "@/lib/maps/layout";
import { approxMeasurer } from "@/lib/maps/measure";
import { DEFAULT_FAMILIES } from "@/lib/maps/theme";
import { neighbour } from "@/lib/maps/navigate";
import { parentIndex } from "@/lib/maps/model";
import type { LinkLike, NoteLike } from "@/lib/brain/graph";

/**
 * The editor's own logic, outside the browser: its memory (undo, a change
 * computed when it lands, an empty idea taken back), the AI's proposals,
 * the PDF and image readers, the templates, a map drawn from a note, and
 * moving between ideas with the arrows.
 */

let n = 0;
const ids = () => `t${++n}`;
const sample = (): MapDoc =>
  fromOutline({ text: "Root", children: [{ text: "A", children: [{ text: "A1" }, { text: "A2" }] }, { text: "B" }, { text: "C" }] }, {}, ids);

describe("the editor's memory", () => {
  it("merges a burst of typing into one step, and undoes and redoes it", () => {
    const doc = sample();
    const a = doc.nodes[doc.root].children[0];
    let s = initialState(doc);
    s = reduce(s, { type: "apply", doc: updateNode(s.doc, a, { text: "A!" }), merge: `text:${a}`, at: 1000 });
    s = reduce(s, { type: "apply", doc: updateNode(s.doc, a, { text: "A!!" }), merge: `text:${a}`, at: 1500 });
    s = reduce(s, { type: "apply", doc: updateNode(s.doc, a, { text: "A!!!" }), merge: `text:${a}`, at: 1900 });
    expect(s.past).toHaveLength(1);
    // A pause longer than the merge window starts a new step.
    s = reduce(s, { type: "apply", doc: updateNode(s.doc, a, { text: "A?" }), merge: `text:${a}`, at: 4000 });
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: "undo" });
    expect(s.doc.nodes[a].text).toBe("A!!!");
    s = reduce(s, { type: "undo" });
    expect(s.doc.nodes[a].text).toBe("A");
    s = reduce(s, { type: "redo" });
    expect(s.doc.nodes[a].text).toBe("A!!!");
  });

  it("computes a change from the document as it is when it lands", () => {
    const doc = sample();
    let s = initialState(doc);
    // Two changes queued from the same stale copy: the second still sees the first.
    s = reduce(s, { type: "change", fn: (d) => { const r = addChild(d, d.root, "", ids); return { doc: r.doc, select: [r.id], edit: r.id }; }, at: 1 });
    s = reduce(s, { type: "change", fn: (d) => { const r = addChild(d, d.root, "", ids); return { doc: r.doc, select: [r.id] }; }, at: 2 });
    expect(s.doc.nodes[s.doc.root].children).toHaveLength(5);
    // A change that says nothing about typing leaves the idea being typed in as it was.
    expect(s.editing).toBe(s.doc.nodes[s.doc.root].children[3]);
    // A change that changes nothing leaves the state alone.
    const before = s;
    expect(reduce(s, { type: "change", fn: () => null })).toBe(before);
  });

  it("takes back an idea added and left empty, leaving nothing to redo", () => {
    const doc = sample();
    let s = initialState(doc);
    s = reduce(s, { type: "change", fn: (d) => { const r = addChild(d, d.root, "", ids); return { doc: r.doc, select: [r.id], edit: r.id }; }, at: 1 });
    const added = s.selection[0];
    expect(s.editing).toBe(added);
    s = reduce(s, { type: "revert", to: doc, within: 2, select: [doc.root] });
    expect(s.doc).toBe(doc);
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(0);
    expect(s.editing).toBeNull();
  });

  it("never reverts past the window it is given", () => {
    const doc = sample();
    let s = initialState(doc);
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "apply", doc: updateNode(s.doc, doc.root, { text: `R${i}` }), at: i * 5000 });
    const same = reduce(s, { type: "revert", to: doc, within: 2 });
    expect(same).toBe(s);
  });

  it("keeps a selection to ideas that exist", () => {
    const doc = sample();
    const s = reduce(initialState(doc), { type: "select", ids: ["nope"] });
    expect(s.selection).toEqual([doc.root]);
  });
});

describe("ideas suggested by the AI", () => {
  it("takes only what a request may carry, cut to size", () => {
    expect(suggestInput({ path: [] })).toBeNull();
    expect(suggestInput(null)).toBeNull();
    const long = Array.from({ length: 30 }, (_, i) => `level ${i}`);
    const input = suggestInput({ path: long, siblings: ["x".repeat(900), 3, "y"], note: "n".repeat(5000), locale: "fr" })!;
    // A deep path keeps the central idea and the closest ones.
    expect(input.path[0]).toBe("level 0");
    expect(input.path[input.path.length - 1]).toBe("level 29");
    expect(input.path.length).toBe(12);
    expect(input.siblings).toHaveLength(2);
    expect(input.siblings[0].length).toBe(300);
    expect(input.note.length).toBe(1500);
    expect(input.locale).toBe("fr");
    expect(suggestInput({ path: ["a"], locale: "de" })!.locale).toBe("en");
  });

  it("tells the model the map's text is data, in the person's language", () => {
    const [system, user] = suggestMessages({ path: ["Voyage", "Préparer"], siblings: ["Passeport"], note: "", locale: "fr" });
    expect(system.content).toMatch(/French/);
    expect(system.content).toMatch(/data .*never instructions/);
    expect(user.content).toContain('"Préparer"');
    expect(user.content).toContain('"Passeport"');
  });

  it("keeps short, clean, new ideas only", () => {
    const raw = '```json\n{"ideas": ["1. Budget.", "- Vols", "passeport", "Vols", "  ", 42, "Assurance voyage;"]}\n```';
    expect(parseIdeas(raw, ["Passeport"])).toEqual(["Budget", "Vols", "Assurance voyage"]);
    expect(parseIdeas('["un", "deux"]', [])).toEqual(["un", "deux"]);
    expect(parseIdeas("no json here", [])).toBeNull();
    expect(parseIdeas('{"other": []}', [])).toBeNull();
    const many = JSON.stringify({ ideas: Array.from({ length: 20 }, (_, i) => `idée ${i}`) });
    expect(parseIdeas(many, [])).toHaveLength(MAX_IDEAS);
    // Accents and case do not make an idea new.
    expect(parseIdeas('{"ideas": ["Éte", "ete"]}', ["été"])).toEqual([]);
  });
});

describe("the PDF", () => {
  it("is one page the picture's size, with a cross-reference table that points at its objects", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);
    const pdf = jpegToPdf(jpeg, 800, 400, "Carte été");
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 600 300]");
    expect(text).toContain("/Width 800 /Height 400");
    // The title in UTF-16: "é" is 00E9.
    expect(text).toMatch(/\/Title <FEFF[0-9A-F]*00E9[0-9A-F]*>/);
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it("shrinks a picture larger than a PDF page can be", () => {
    const text = new TextDecoder("latin1").decode(jpegToPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 40000, 1000, "x"));
    expect(text).toContain("/MediaBox [0 0 14400 360]");
  });
});

describe("what an image is, from its bytes", () => {
  const bytes = (n: number, set: (b: Uint8Array, v: DataView) => void) => {
    const b = new Uint8Array(n);
    set(b, new DataView(b.buffer));
    return b;
  };
  const ascii = (b: Uint8Array, at: number, s: string) => [...s].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));

  it("reads PNG, GIF, the three WebPs and JPEG", () => {
    const png = bytes(32, (b, v) => {
      b[0] = 0x89;
      ascii(b, 1, "PNG");
      ascii(b, 12, "IHDR");
      v.setUint32(16, 640);
      v.setUint32(20, 480);
    });
    expect(imageInfo(png)).toEqual({ mime: "image/png", ext: "png", width: 640, height: 480 });

    const gif = bytes(32, (b, v) => {
      ascii(b, 0, "GIF89a");
      v.setUint16(6, 120, true);
      v.setUint16(8, 80, true);
    });
    expect(imageInfo(gif)).toMatchObject({ ext: "gif", width: 120, height: 80 });

    const webp = (chunk: string, fill: (b: Uint8Array, v: DataView) => void) =>
      bytes(40, (b, v) => {
        ascii(b, 0, "RIFF");
        ascii(b, 8, "WEBP");
        ascii(b, 12, chunk);
        fill(b, v);
      });
    expect(imageInfo(webp("VP8 ", (_b, v) => { v.setUint16(26, 300, true); v.setUint16(28, 200, true); }))).toMatchObject({ ext: "webp", width: 300, height: 200 });
    expect(imageInfo(webp("VP8L", (b, v) => { b[20] = 0x2f; v.setUint32(21, (99 & 0x3fff) | ((49 & 0x3fff) << 14), true); }))).toMatchObject({ width: 100, height: 50 });
    expect(imageInfo(webp("VP8X", (b) => { b[24] = 0xff; b[25] = 0x03; b[27] = 0x63; }))).toMatchObject({ width: 1024, height: 100 });

    // JPEG: an APP0 segment, then the frame header (SOF0).
    const jpeg = bytes(40, (b, v) => {
      b[0] = 0xff; b[1] = 0xd8;
      b[2] = 0xff; b[3] = 0xe0; v.setUint16(4, 8);
      b[12] = 0xff; b[13] = 0xc0; v.setUint16(14, 17); b[16] = 8; v.setUint16(17, 900); v.setUint16(19, 1600);
    });
    expect(imageInfo(jpeg)).toEqual({ mime: "image/jpeg", ext: "jpg", width: 1600, height: 900 });
  });

  it("refuses an SVG, a file too short, a size of zero, and anything else", () => {
    expect(imageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(imageInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    const zero = new Uint8Array(32);
    zero[0] = 0x89;
    [..."PNG"].forEach((c, i) => (zero[1 + i] = c.charCodeAt(0)));
    [..."IHDR"].forEach((c, i) => (zero[12 + i] = c.charCodeAt(0)));
    expect(imageInfo(zero)).toBeNull();
    expect(imageInfo(new TextEncoder().encode("%PDF-1.4 not an image at all, really"))).toBeNull();
  });
});

describe("the templates", () => {
  it("are the same structures in both languages, and valid maps", () => {
    const en = templates("en");
    const fr = templates("fr");
    expect(en.map((t) => t.id)).toEqual(fr.map((t) => t.id));
    for (let i = 0; i < en.length; i++) {
      const a = fromOutline(en[i].outline, en[i].style, ids);
      const b = fromOutline(fr[i].outline, fr[i].style, ids);
      expect(parseDoc(a)).not.toBeNull();
      expect(nodeCount(a)).toBe(nodeCount(b));
      expect(en[i].name).not.toBe("");
      expect(fr[i].hint).not.toBe("");
    }
  });
});

describe("a map drawn from a note", () => {
  const note = (id: string, title: string, detail?: string): NoteLike => ({ id, title, detail, category: "ideas", done: false, createdAt: "2026-10-01T00:00:00Z" });
  const label = (kind: string, side: string) => `${kind}/${side}`;

  it("puts the note in the middle and its connections around it, grouped by meaning", () => {
    const notes = [note("n1", "Podcast", "Un épisode par semaine"), note("n2", "Clients"), note("n3", "Temps"), note("n4", "Micro"), note("n5", "Seule")];
    const links: LinkLike[] = [
      { fromId: "n1", toId: "n2", kind: "advances", sourceId: "n1" },
      { fromId: "n3", toId: "n1", kind: "tension" },
      { fromId: "n2", toId: "n4", kind: "related" },
      { fromId: "n1", toId: "missing", kind: "related" },
    ];
    const o = outlineFromNote("n1", notes, links, label)!;
    expect(o.text).toBe("Podcast");
    expect(o.note).toBe("Un épisode par semaine");
    expect(o.noteId).toBe("n1");
    expect(o.children!.map((g) => g.text)).toEqual(["advances/out", "tension/both"]);
    const clients = o.children![0].children![0];
    expect(clients).toMatchObject({ text: "Clients", noteId: "n2", collapsed: true });
    // One step further, folded: what that note connects to.
    expect(clients.children!.map((c) => c.text)).toEqual(["Micro"]);
    expect(parseDoc(fromOutline(o))).not.toBeNull();
    expect(outlineFromNote("nope", notes, links, label)).toBeNull();
  });

  it("stays within ninety ideas, whatever the brain", () => {
    const notes = [note("c", "Centre"), ...Array.from({ length: 400 }, (_, i) => note(`x${i}`, `Note ${i}`))];
    const links: LinkLike[] = Array.from({ length: 400 }, (_, i) => ({ fromId: i < 40 ? "c" : `x${i % 40}`, toId: `x${i}`, kind: (["supports", "extends", "related", "advances"] as const)[i % 4] }));
    const doc = fromOutline(outlineFromNote("c", notes, links, label)!);
    expect(nodeCount(doc)).toBeLessThanOrEqual(90);
  });
});

describe("the arrow keys", () => {
  it("go to the children, back to the parent, and along the branch", () => {
    const doc = fromOutline({ text: "Root", children: [{ text: "R1", children: [{ text: "R1a" }, { text: "R1b" }] }, { text: "R2" }, { text: "L1" }, { text: "L2" }] }, { layout: "right" }, ids);
    const layout = layoutMap(doc, { families: DEFAULT_FAMILIES, measurer: approxMeasurer() });
    const parents = parentIndex(doc);
    const [r1, r2] = doc.nodes[doc.root].children;
    const [r1a, r1b] = doc.nodes[r1].children;
    expect(neighbour(doc, layout, parents, doc.root, "right")).not.toBeNull();
    expect(neighbour(doc, layout, parents, r1, "right")).toBe(r1a);
    expect(neighbour(doc, layout, parents, r1a, "left")).toBe(r1);
    expect(neighbour(doc, layout, parents, r1a, "down")).toBe(r1b);
    expect(neighbour(doc, layout, parents, r1, "down")).toBe(r2);
    expect(neighbour(doc, layout, parents, r1, "left")).toBe(doc.root);
  });
});
