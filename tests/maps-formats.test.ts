import { describe, it, expect } from "vitest";
import { fromOutline, toOutline, type Outline } from "@/lib/maps/model";
import { parseFreemind, parseIndented, parseMarkdown, parseMermaid, parseOpml, toFreemind, toMarkdown, toMermaid, toOpml } from "@/lib/maps/formats/outline";
import { exportText, importMap, ImportError, NATIVE_FORMAT, toNative } from "@/lib/maps/formats";
import { parseXmind, toXmind } from "@/lib/maps/formats/xmind";
import { decodeEntities, parseXml, textOf } from "@/lib/maps/formats/xml";
import { readZip } from "@/lib/maps/formats/unzip";
import { ZipWriter } from "@/lib/export/zip";

const enc = new TextEncoder();

/** What survives a text format: text, emoji, note, link, the tree. */
function essence(o: Outline): unknown {
  return { t: [o.emoji, o.text].filter(Boolean).join(" "), n: o.note?.trim() || undefined, l: o.link, c: (o.children ?? []).map(essence) };
}

const sample: Outline = {
  text: "Lancer LifeOS",
  note: "L'objectif de l'année",
  children: [
    {
      text: "Produit",
      emoji: "🚀",
      children: [
        { text: "Cartes mentales", note: "Import & export\nPNG, SVG" },
        { text: "Agent (VPS)", link: "https://lifeos.app/agent" },
      ],
    },
    { text: "Marché", children: [{ text: "Fondateurs", children: [{ text: "Entretiens « terrain »" }] }] },
    { text: "Finances" },
  ],
};

async function zip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const z = new ZipWriter();
  const parts: Uint8Array[] = [];
  for (const [name, data] of Object.entries(files)) parts.push(...z.file(name, typeof data === "string" ? enc.encode(data) : data));
  parts.push(z.finish());
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("text formats, out and back in", () => {
  it("Markdown", () => {
    const md = toMarkdown(sample);
    expect(md).toContain("# Lancer LifeOS");
    expect(md).toContain("## 🚀 Produit");
    expect(md).toContain("- [Agent (VPS)](https://lifeos.app/agent)");
    expect(essence(parseMarkdown(md, "x"))).toEqual(essence(sample));
  });

  it("OPML", () => {
    expect(essence(parseOpml(toOpml(sample, "Lancer LifeOS"), "x"))).toEqual(essence(sample));
  });

  it("FreeMind, with sides, folds and branch colours", () => {
    const o: Outline = { ...sample, children: sample.children!.map((c, i) => ({ ...c, side: i === 0 ? "left" : "right", color: i === 1 ? "#336699" : undefined })) };
    o.children![1].collapsed = true;
    const back = parseFreemind(toFreemind(o), "x");
    expect(essence(back)).toEqual(essence(sample));
    expect(back.children![0].side).toBe("left");
    expect(back.children![1].color).toBe("#336699");
    expect(back.children![1].collapsed).toBe(true);
  });

  it("Mermaid, quotes and brackets included", () => {
    const tricky: Outline = { text: "Plan (v2)", children: [{ text: 'Dire "oui" [souvent]', children: [{ text: "a(b)" }] }] };
    expect(essence(parseMermaid(toMermaid(tricky), "x"))).toEqual(essence(tricky));
  });

  it("an indented paste: tabs or spaces, bullets, numbers, checkboxes, a link", () => {
    const forest = parseIndented("Objectifs\n  - Lancer\n    1. Bêta\n    2. [x] Paiement\n  - [ ] Recruter\nAutre — https://example.org");
    expect(forest).toHaveLength(2);
    expect(forest[0].children!.map((c) => [c.emoji, c.text])).toEqual([[undefined, "Lancer"], ["⬜", "Recruter"]]);
    expect(forest[0].children![0].children!.map((c) => [c.emoji, c.text])).toEqual([[undefined, "Bêta"], ["✅", "Paiement"]]);
    expect(forest[1]).toMatchObject({ text: "Autre", link: "https://example.org/" });
    // Two levels deeper than the line above still nests under it; its siblings stay siblings.
    const jump = parseIndented("A\n      B\n      C");
    expect(jump[0].children!.map((c) => c.text)).toEqual(["B", "C"]);
  });

  it("reads most Markdown outlines: several titles, deep lists, notes, a code block ignored", () => {
    const o = parseMarkdown("# Un\ntexte libre\n## Deux\n- a\n  - b\n```\n# pas un titre\n```\n# Trois", "Fichier");
    expect(o.text).toBe("Fichier");
    expect(o.children!.map((c) => c.text)).toEqual(["Un", "Trois"]);
    expect(o.children![0].note).toBe("texte libre");
    expect(o.children![0].children![0].children![0].children![0].text).toBe("b");
  });
});

describe("XMind", () => {
  it("writes a file XMind reads (JSON and XML), and reads it back with its images", async () => {
    const withImage: Outline = { ...sample, children: [...sample.children!, { text: "Logo", image: { file: "0123456789abcdef0123456789abcdef.png", width: 640, height: 480 } }] };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const file = await toXmind(withImage, "Carte", "right", async () => ({ bytes: png, ext: "png" }));
    const entries = await readZip(file);
    expect([...entries.keys()]).toEqual(expect.arrayContaining(["content.json", "content.xml", "manifest.json", "metadata.json", "META-INF/manifest.xml"]));
    const sheets = await parseXmind(file);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].layout).toBe("right");
    expect(essence(sheets[0].outline)).toEqual(essence({ ...withImage, children: withImage.children!.map((c) => ({ ...c })) }));
    const logo = sheets[0].outline.children!.at(-1)!;
    expect(logo.image?.file).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(sheets[0].assets[logo.image!.file]).toBe("data:image/png;base64,iVBORwECAw==");
  });

  it("reads an XMind 8 file (XML only), markers as emoji", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet id="s"><topic id="r" structure-class="org.xmind.ui.org-chart.down"><title>Racine</title><children><topics type="attached"><topic id="a"><title>A &amp; B</title><marker-refs><marker-ref marker-id="priority-1"/></marker-refs><notes><plain>Une note</plain></notes></topic></topics><topics type="detached"><topic id="d"><title>Flottant</title></topic></topics></children></topic><title>Feuille</title></sheet></xmap-content>`;
    const sheets = await parseXmind(await zip({ "content.xml": xml }));
    expect(sheets[0].title).toBe("Feuille");
    expect(sheets[0].layout).toBe("down");
    expect(sheets[0].outline).toMatchObject({ text: "Racine", children: [{ text: "A & B", emoji: "1️⃣", note: "Une note" }] });
    expect(sheets[0].outline.children).toHaveLength(1);
  });
});

describe("importing a file", () => {
  it("recognises the format by its name or its content", async () => {
    const md = await importMap("plan.md", enc.encode(toMarkdown(sample)));
    expect(essence(toOutline(md[0].doc))).toEqual(essence(sample));
    const opml = await importMap("export", enc.encode(toOpml(sample, "Lancer LifeOS")));
    expect(opml[0].title).toBe("Lancer LifeOS");
    const mm = await importMap("x.mm", enc.encode(toFreemind(sample)));
    expect(mm[0].doc.nodes[mm[0].doc.root].text).toBe("Lancer LifeOS");
    const text = await importMap("liste.txt", enc.encode("Courses\n\tPain\n\tLait"));
    expect(text[0].title).toBe("Courses");
    const xmind = await importMap("carte.xmind", await toXmind(sample, "Carte", "map", async () => null));
    expect(xmind[0].title).toBe("Carte");
  });

  it("restores LifeOS's own file exactly, keeping only the images it carries and are images", async () => {
    const doc = fromOutline({ text: "R", children: [{ text: "a", image: { file: "0123456789abcdef.png", width: 10, height: 10 } }, { text: "b", image: { file: "fedcba9876543210.png", width: 10, height: 10 } }] }, { theme: "paper", layout: "down" });
    const file = toNative(doc, "Ma carte", { "0123456789abcdef.png": "data:image/png;base64,AAAA", "fedcba9876543210.png": "javascript:alert(1)" });
    const [got] = await importMap("ma-carte.lifeosmap.json", enc.encode(JSON.stringify(file)));
    expect(file.format).toBe(NATIVE_FORMAT);
    expect(got.title).toBe("Ma carte");
    expect(got.doc.style).toMatchObject({ theme: "paper", layout: "down" });
    expect(Object.keys(got.assets)).toEqual(["0123456789abcdef.png"]);
    const b = Object.values(got.doc.nodes).find((n) => n.text === "b")!;
    expect(b.image).toBeUndefined();
  });

  it("says why it refuses", async () => {
    await expect(importMap("vide.md", new Uint8Array())).rejects.toMatchObject({ code: "empty" });
    await expect(importMap("x.xmind", enc.encode("not a zip"))).rejects.toBeInstanceOf(ImportError);
    await expect(importMap("x.json", enc.encode('{"version":1}'))).rejects.toMatchObject({ code: "damaged" });
  });

  it("exports the text formats from any branch", () => {
    const doc = fromOutline(sample);
    const produit = Object.values(doc.nodes).find((n) => n.text === "Produit")!.id;
    expect(exportText(doc, "md", produit)).toMatch(/^# 🚀 Produit/);
    expect(exportText(doc, "txt")).toContain("\n\t🚀 Produit\n\t\tCartes mentales");
    expect(exportText(doc, "mermaid")).toMatch(/^mindmap/);
  });
});

describe("reading XML safely", () => {
  it("decodes the standard entities and character references, and never expands a declared one", () => {
    expect(decodeEntities("&lt;a&gt; &amp; &#233;t&#xE9; &unknown;")).toBe("<a> & été &unknown;");
    const doc = parseXml('<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><opml><body><outline text="&xxe;" note=\'single\'/></body></opml>');
    const outline = (doc.children[0] as { children: { attrs: Record<string, string> }[] }).children[0];
    expect(outline.attrs.text).toBe("&xxe;");
    expect(outline.attrs.note).toBe("single");
    expect(textOf(parseXml("<p>a<![CDATA[<b>]]>c</p>"))).toBe("a<b>c\n");
  });
});
