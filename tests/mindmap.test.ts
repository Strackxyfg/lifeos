import { describe, it, expect } from "vitest";
import { mindMap } from "@/lib/brain/mindmap";
import type { LinkLike, NoteLike } from "@/lib/brain/graph";
import type { BrainCategoryId } from "@/lib/data/brain";

const note = (id: string, title = id, concepts: string[] = [], category: BrainCategoryId = "ideas", done = false): NoteLike => ({
  id, category, title, detail: null, done, createdAt: "2026-09-01T00:00:00.000Z",
  concepts: concepts.map((k) => ({ k, l: k })),
});
const link = (a: string, b: string, kind: LinkLike["kind"] = "related", origin: LinkLike["origin"] = "user"): LinkLike => ({
  fromId: a < b ? a : b, toId: a < b ? b : a, kind, origin,
});
/** Every pair of the given ids linked. */
const clique = (ids: string[], kind: LinkLike["kind"] = "related") =>
  ids.flatMap((a, i) => ids.slice(i + 1).map((b) => link(a, b, kind)));

describe("constellations", () => {
  // Two tight groups — business and sport — joined by one bridge note.
  const business = ["b1", "b2", "b3", "b4"];
  const sport = ["s1", "s2", "s3", "s4"];
  const notes = [
    ...business.map((id) => note(id, `Business ${id}`, ["client acquisition", "pricing"])),
    ...sport.map((id) => note(id, `Sport ${id}`, ["running", "training plan"])),
    note("bridge", "Courir avec des clients le dimanche", ["running", "client acquisition"]),
    note("alone", "Renouveler le passeport", ["passport"]),
  ];
  const links = [
    ...clique(business, "advances"),
    ...clique(sport, "supports"),
    link("bridge", "b1"),
    link("bridge", "b2"),
    link("bridge", "s1"),
    link("bridge", "s2"),
  ];
  const map = mindMap({ notes, links });

  it("finds the two universes", () => {
    const groups = map.constellations.map((c) => new Set(c.noteIds));
    expect(groups).toHaveLength(2);
    expect(groups.some((g) => business.every((id) => g.has(id)))).toBe(true);
    expect(groups.some((g) => sport.every((id) => g.has(id)))).toBe(true);
    expect(map.modularity).toBeGreaterThan(0.3);
  });

  it("names each one from its most distinctive concepts", () => {
    const names = map.constellations.map((c) => c.name).sort();
    expect(names.some((n) => /client acquisition|pricing/.test(n))).toBe(true);
    expect(names.some((n) => /running|training plan/.test(n))).toBe(true);
  });

  it("leaves a note connected to nothing out of every constellation", () => {
    expect(map.membership.has("alone")).toBe(false);
  });

  it("finds the note that joins them", () => {
    expect(map.bridges.map((b) => b.id)).toEqual(["bridge"]);
    const between = new Set(map.bridges[0].between);
    expect(between.size).toBe(2);
    expect(map.bridges[0].participation).toBeGreaterThan(0.4);
  });

  it("ranks the most connected notes as core ideas — centrality, not bridging", () => {
    // b1, b2, s1, s2 hold their group together *and* touch the bridge: the
    // strongest ties. The bridge itself is found by `bridges`, not here.
    expect(new Set(map.core.slice(0, 4).map((c) => c.id))).toEqual(new Set(["b1", "b2", "s1", "s2"]));
    expect(map.core.map((c) => c.id)).not.toContain("alone");
  });

  it("gives every constellation its own colour", () => {
    const colours = map.constellations.map((c) => c.color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("is deterministic, whatever the input order", () => {
    const again = mindMap({ notes: [...notes].reverse(), links: [...links].reverse() });
    expect(again.constellations).toEqual(map.constellations);
    expect(again.core).toEqual(map.core);
    expect(again.bridges).toEqual(map.bridges);
  });
});

describe("what the map is drawn from", () => {
  it("groups notes nobody connected yet, through the concepts they share", () => {
    const notes = [
      note("a", "A", ["referral program"]),
      note("b", "B", ["referral program"]),
      note("c", "C", ["referral program"]),
      note("x", "X", ["half marathon"]),
      note("y", "Y", ["half marathon"]),
      note("z", "Z", ["half marathon"]),
      ...Array.from({ length: 20 }, (_, i) => note(`f${i}`, `Filler ${i}`, [`topic ${i}`])),
    ];
    const map = mindMap({ notes, links: [] });
    const sets = map.constellations.map((c) => [...c.noteIds].sort().join(","));
    expect(sets).toContain("a,b,c");
    expect(sets).toContain("x,y,z");
  });

  it("ignores finished notes — the map is of the living brain", () => {
    const notes = [note("a"), note("b"), note("c"), note("d", "d", [], "next", true)];
    const map = mindMap({ notes, links: [...clique(["a", "b", "c", "d"])] });
    expect([...map.membership.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("counts a connection awaiting review for less than one the person kept", () => {
    // Triangle a-b-c kept, triangle c-d-e drawn by the engine: c goes with the kept one.
    const notes = ["a", "b", "c", "d", "e"].map((id) => note(id));
    const links = [
      ...clique(["a", "b", "c"]),
      link("c", "d", "related", "ai"),
      link("c", "e", "related", "ai"),
      link("d", "e", "related", "ai"),
      link("d", "e2", "related", "ai"),
    ];
    const map = mindMap({ notes, links });
    const withC = map.constellations.find((k) => k.noteIds.includes("c"));
    expect(withC?.noteIds).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("draws nothing from too little", () => {
    expect(mindMap({ notes: [], links: [] }).constellations).toEqual([]);
    expect(mindMap({ notes: [note("a"), note("b")], links: [link("a", "b")] }).constellations).toEqual([]);
    // Notes but no connection of any kind: no constellation, no core.
    const flat = mindMap({ notes: ["a", "b", "c", "d"].map((id) => note(id)), links: [] });
    expect(flat.constellations).toEqual([]);
    expect(flat.core).toEqual([]);
  });

  it("stays fast on a large brain", () => {
    let s = 11;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const notes = Array.from({ length: 3_000 }, (_, i) =>
      note(`n${i}`, `n${i}`, Array.from({ length: 3 }, () => `k${Math.floor(Math.pow(rnd(), 1.5) * 400)}`))
    );
    const links = Array.from({ length: 4_000 }, () => {
      const a = Math.floor(rnd() * 3_000);
      const b = Math.floor(rnd() * 3_000);
      return link(`n${a}`, `n${b}`);
    }).filter((l) => l.fromId !== l.toId);
    const t = performance.now();
    const map = mindMap({ notes, links });
    expect(performance.now() - t).toBeLessThan(5_000);
    expect(map.constellations.length).toBeGreaterThan(3);
  });
});
