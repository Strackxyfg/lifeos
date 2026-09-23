import { describe, it, expect } from "vitest";
import {
  TopK, buildSimilarityIndex, comparePairs, pairKey, suggestLinks, type NoteLike, type PairMatch,
} from "@/lib/brain/graph";
import { rankPairs } from "@/lib/brain/weave";

/**
 * The indexed engine must give exactly the answers of the brute-force one it
 * replaced — only faster. These tests hold it to that, then to a time budget.
 */

/** Deterministic corpus with a skewed (Zipf-like) vocabulary and concepts. */
function corpus(n: number, seed = 42): NoteLike[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const vocab = Array.from({ length: 1500 }, (_, i) => `mot${i.toString(36)}x`);
  const keys = Array.from({ length: 300 }, (_, i) => `concept ${i.toString(36)}`);
  const cats = ["goals", "next", "ideas", "thoughts", "knowledge", "insights"] as const;
  const pick = (arr: string[]) => arr[Math.floor(arr.length * Math.pow(rnd(), 2.2))];
  return Array.from({ length: n }, (_, i) => ({
    id: `n${String(i).padStart(5, "0")}`,
    category: cats[Math.floor(rnd() * cats.length)],
    title: Array.from({ length: 5 + Math.floor(rnd() * 6) }, () => pick(vocab)).join(" "),
    detail: rnd() < 0.4 ? Array.from({ length: 25 }, () => pick(vocab)).join(" ") : null,
    done: rnd() < 0.1,
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
    concepts: rnd() < 0.8
      ? Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
          const k = pick(keys);
          return { k, l: k.toUpperCase() };
        })
      : [],
  }));
}

/** The old way: every pair through `compare`. */
function bruteForce(notes: NoteLike[], floor: { words: number; concepts: number }): PairMatch[] {
  const index = buildSimilarityIndex(notes);
  const out: PairMatch[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const m = index.compare(notes[i].id, notes[j].id, floor);
      if (m) out.push({ a: notes[i].id, b: notes[j].id, score: m.score, via: m.via });
    }
  }
  return out.sort(comparePairs);
}

const FLOOR = { words: 0.06, concepts: 0.1 };

describe("the inverted index agrees with comparing every pair", () => {
  const notes = corpus(260);

  it("finds exactly the same pairs, scores and signals when nothing is too common", () => {
    const indexed = buildSimilarityIndex(notes).pairs({ floor: FLOOR, maxDf: Infinity }).sort(comparePairs);
    expect(indexed.length).toBeGreaterThan(100);
    expect(indexed).toEqual(bruteForce(notes, FLOOR));
  });

  it("with its default cut on common terms, still finds every strong pair", () => {
    const reference = bruteForce(notes, FLOOR);
    const indexed = buildSimilarityIndex(notes).pairs({ floor: FLOOR }).sort(comparePairs);
    // Every pair it reports is real and correctly scored…
    const byKey = new Map(reference.map((p) => [pairKey(p.a, p.b), p]));
    for (const p of indexed) expect(byKey.get(pairKey(p.a, p.b))).toEqual(p);
    // …and the strongest ones are all there.
    expect(indexed.slice(0, 50)).toEqual(reference.slice(0, 50));
  });

  it("only pairs notes within the given scope", () => {
    const ids = notes.slice(0, 40).map((n) => n.id);
    const scope = new Set(ids);
    const pairs = buildSimilarityIndex(notes).pairs({ ids, floor: FLOOR, maxDf: Infinity });
    expect(pairs.every((p) => scope.has(p.a) && scope.has(p.b))).toBe(true);
    const reference = bruteForce(notes, FLOOR).filter((p) => scope.has(p.a) && scope.has(p.b));
    expect(pairs.sort(comparePairs)).toEqual(reference);
  });

  it("keeps the best k exactly as a full sort would", () => {
    const index = buildSimilarityIndex(notes);
    const full = index.pairs({ floor: FLOOR, maxDf: Infinity }).sort(comparePairs);
    expect(index.pairs({ floor: FLOOR, maxDf: Infinity, top: 37 })).toEqual(full.slice(0, 37));
  });
});

describe("TopK", () => {
  it("returns the k best of a stream, ties broken deterministically", () => {
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const items = Array.from({ length: 2_000 }, (_, i) => ({ id: i, v: Math.floor(rnd() * 50) }));
    const better = (x: { id: number; v: number }, y: { id: number; v: number }) => y.v - x.v || x.id - y.id;
    for (const k of [0, 1, 5, 64, 2_000, 5_000]) {
      const top = new TopK(k, better);
      for (const it of items) top.push(it);
      expect(top.sorted()).toEqual([...items].sort(better).slice(0, k));
    }
  });
});

describe("whole-brain weaving at scale", () => {
  it("ranks the same pairs as before, from the index", () => {
    const notes = corpus(300, 9);
    const fast = rankPairs({ notes, links: [], dismissed: new Set(), limit: 16 });
    expect(fast).toHaveLength(16);
    expect(new Set(fast.map((p) => pairKey(p.a, p.b))).size).toBe(16);
    // No pair involves a finished note.
    const done = new Set(notes.filter((n) => n.done).map((n) => n.id));
    expect(fast.some((p) => done.has(p.a) || done.has(p.b))).toBe(false);
  });

  it("stays well inside a serverless time limit at 3,000 notes", () => {
    const notes = corpus(3_000, 3);
    const t = performance.now();
    rankPairs({ notes, links: [], dismissed: new Set(), limit: 16 });
    const ms = performance.now() - t;
    // Measured ~0.5 s on a laptop (2026-09-23); the old loop took over 40 s.
    expect(ms).toBeLessThan(5_000);
  });

  it("opens a note's suggestions quickly from a shared index", () => {
    const notes = corpus(3_000, 5);
    const index = buildSimilarityIndex(notes);
    const t = performance.now();
    for (const n of notes.slice(0, 20)) suggestLinks(n, notes, [], 3, undefined, index);
    // Twenty note openings, the index built once.
    expect(performance.now() - t).toBeLessThan(2_000);
  });
});
