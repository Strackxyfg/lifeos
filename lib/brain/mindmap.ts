import type { LinkLike, NoteLike } from "./graph";
import type { RelationKind } from "./relations";

/**
 * The shape of a mind: which notes form a universe together, which ideas the
 * rest hangs on, and which notes join two universes.
 *
 * A second brain that only stores notes shows you what you wrote. This shows
 * you how you think — the constellations of notes you keep returning to, the
 * core ideas they orbit, and the bridges between them, the places where one
 * part of your life meets another.
 *
 * All of it is graph science on data the brain already has, run on the
 * device: no model, no network, deterministic — the same brain always draws
 * the same map.
 *
 *  - The graph: open notes; explicit connections weighted by what they mean
 *    (unreviewed ones count less), plus weak edges between notes that share
 *    specific concepts, so a note nobody connected yet still finds its place.
 *  - Constellations: Louvain community detection — the standard method for
 *    finding groups in a network, by maximising modularity.
 *  - Core ideas: PageRank on the same weighted graph.
 *  - Bridges: participation coefficient — how evenly a note's connections
 *    spread over several constellations.
 */

export interface Constellation {
  id: string;
  /** From the concepts most distinctive of the group; the central note's title otherwise. */
  name: string;
  /** Most central first. */
  noteIds: string[];
  color: string;
}

export interface MindMap {
  constellations: Constellation[];
  /** Note id → constellation id, for notes that belong to one. */
  membership: Map<string, string>;
  /** The notes the brain hangs on, most central first. */
  core: { id: string; score: number }[];
  /** Notes whose connections span two constellations, with the two. */
  bridges: { id: string; between: [string, string]; participation: number }[];
  /** Newman–Girvan modularity of the partition: above ~0.3, the groups are real. */
  modularity: number;
}

/** How much each kind of connection binds two notes into one universe. */
export const EDGE_WEIGHT: Record<RelationKind, number> = {
  advances: 1,
  supports: 0.9,
  extends: 0.8,
  related: 0.6,
  // Two notes in tension are about the same thing, from opposite sides.
  tension: 0.5,
};
const UNREVIEWED = 0.6;
/** A shared specific concept binds, but less than a connection someone made or kept. */
const AFFINITY = 0.35;
const MIN_CONSTELLATION = 3;
const MAX_AFFINITY_PER_NOTE = 8;

/** Distinct on dark and light, and distinct from one another. */
export const CONSTELLATION_COLORS = [
  "#f472b6", "#a78bfa", "#34d399", "#fbbf24", "#60a5fa", "#fb923c", "#2dd4bf", "#e879f9", "#a3e635", "#f87171",
];

type Graph = { n: number; adj: Map<number, number>[]; strength: number[]; total: number };

function buildGraph(notes: NoteLike[], links: LinkLike[]): Graph {
  const n = notes.length;
  const pos = new Map(notes.map((x, i) => [x.id, i]));
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const add = (i: number, j: number, w: number) => {
    if (i === j || w <= 0) return;
    adj[i].set(j, (adj[i].get(j) ?? 0) + w);
    adj[j].set(i, (adj[j].get(i) ?? 0) + w);
  };

  for (const l of links) {
    const i = pos.get(l.fromId);
    const j = pos.get(l.toId);
    if (i === undefined || j === undefined) continue;
    const unreviewed = l.origin === "ai" || l.origin === "agent";
    add(i, j, EDGE_WEIGHT[l.kind ?? "related"] * (unreviewed ? UNREVIEWED : 1));
  }

  // Concept affinity: notes sharing a specific concept. A concept most of the
  // brain shares says nothing about which universe a note is in; skipped.
  const byKey = new Map<string, number[]>();
  notes.forEach((x, i) => {
    for (const c of x.concepts ?? []) (byKey.get(c.k) ?? byKey.set(c.k, []).get(c.k)!).push(i);
  });
  const maxShare = Math.max(4, Math.ceil(n * 0.15));
  const affinity: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const members of byKey.values()) {
    if (members.length < 2 || members.length > maxShare) continue;
    const w = 1 / Math.log2(1 + members.length); // rarer shared concept, stronger bond
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const i = members[a];
        const j = members[b];
        affinity[i].set(j, (affinity[i].get(j) ?? 0) + w);
      }
    }
  }
  // Each note keeps only its strongest affinities: without the cap, one
  // popular concept would knit a whole region into a single blob.
  for (let i = 0; i < n; i++) {
    const top = [...affinity[i].entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, MAX_AFFINITY_PER_NOTE);
    for (const [j, w] of top) add(i, j, AFFINITY * Math.min(1, w));
  }

  const strength = adj.map((m) => [...m.values()].reduce((s, w) => s + w, 0));
  const total = strength.reduce((s, w) => s + w, 0) / 2;
  return { n, adj, strength, total };
}

/**
 * Louvain: move each node to the neighbouring community that raises
 * modularity most, until nothing moves; fold communities into nodes; repeat.
 * Nodes are visited in index order and ties go to the lowest community, so
 * the result is deterministic.
 */
function louvain(g: Graph, resolution = 1): number[] {
  let membership = Array.from({ length: g.n }, (_, i) => i);
  let adj = g.adj;
  let strength = g.strength;
  const m2 = 2 * g.total;
  if (g.total === 0) return membership;

  for (let level = 0; level < 20; level++) {
    const n = adj.length;
    const community = Array.from({ length: n }, (_, i) => i);
    const tot = strength.slice(); // Σ strength of each community
    let moved = true;
    let improved = false;
    for (let pass = 0; moved && pass < 50; pass++) {
      moved = false;
      for (let i = 0; i < n; i++) {
        const ki = strength[i];
        if (ki === 0) continue;
        const own = community[i];
        // Weight from i to each neighbouring community.
        const toCom = new Map<number, number>();
        for (const [j, w] of adj[i]) if (j !== i) toCom.set(community[j], (toCom.get(community[j]) ?? 0) + w);
        tot[own] -= ki;
        const gain = (c: number) => (toCom.get(c) ?? 0) - (resolution * tot[c] * ki) / m2;
        // Stay unless a community is strictly better; candidates in ascending
        // order, so among equals the lowest wins — every run agrees.
        let best = own;
        let bestGain = gain(own);
        for (const c of [...toCom.keys()].sort((a, b) => a - b)) {
          const gc = gain(c);
          if (gc > bestGain + 1e-12) {
            best = c;
            bestGain = gc;
          }
        }
        tot[best] += ki;
        if (best !== own) {
          community[i] = best;
          moved = true;
          improved = true;
        }
      }
    }
    if (!improved) break;

    // Renumber communities 0..k-1 in order of first appearance.
    const renum = new Map<number, number>();
    for (const c of community) if (!renum.has(c)) renum.set(c, renum.size);
    membership = membership.map((c) => renum.get(community[c])!);

    // Fold: each community becomes a node.
    const k = renum.size;
    const folded: Map<number, number>[] = Array.from({ length: k }, () => new Map());
    const foldedStrength = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const ci = renum.get(community[i])!;
      foldedStrength[ci] += strength[i];
      for (const [j, w] of adj[i]) {
        const cj = renum.get(community[j])!;
        folded[ci].set(cj, (folded[ci].get(cj) ?? 0) + w);
      }
    }
    if (k === n) break;
    adj = folded;
    strength = foldedStrength;
  }
  return membership;
}

/** Newman–Girvan modularity of a partition. */
function modularity(g: Graph, membership: number[]): number {
  if (g.total === 0) return 0;
  const m2 = 2 * g.total;
  const inside = new Map<number, number>();
  const tot = new Map<number, number>();
  for (let i = 0; i < g.n; i++) {
    const c = membership[i];
    tot.set(c, (tot.get(c) ?? 0) + g.strength[i]);
    for (const [j, w] of g.adj[i]) if (membership[j] === c) inside.set(c, (inside.get(c) ?? 0) + w);
  }
  let q = 0;
  for (const [c, t] of tot) q += (inside.get(c) ?? 0) / m2 - (t / m2) ** 2;
  return q;
}

/** Weighted PageRank; a note with no connection shares its rank with everyone. */
function pagerank(g: Graph, damping = 0.85): number[] {
  const n = g.n;
  if (n === 0) return [];
  let rank = new Array<number>(n).fill(1 / n);
  for (let iter = 0; iter < 100; iter++) {
    const next = new Array<number>(n).fill((1 - damping) / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (g.strength[i] === 0) {
        dangling += rank[i];
        continue;
      }
      for (const [j, w] of g.adj[i]) next[j] += (damping * rank[i] * w) / g.strength[i];
    }
    for (let i = 0; i < n; i++) next[i] += (damping * dangling) / n;
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - rank[i]);
    rank = next;
    if (delta < 1e-10) break;
  }
  return rank;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function mindMap(input: { notes: NoteLike[]; links: LinkLike[] }): MindMap {
  const notes = input.notes.filter((n) => !n.done).sort((a, b) => a.id.localeCompare(b.id));
  const empty: MindMap = { constellations: [], membership: new Map(), core: [], bridges: [], modularity: 0 };
  if (notes.length < MIN_CONSTELLATION) return empty;

  const g = buildGraph(notes, input.links);
  const raw = louvain(g);
  const q = modularity(g, raw);
  const rank = pagerank(g);

  // Communities worth a name: three notes or more, connected at all.
  const groups = new Map<number, number[]>();
  raw.forEach((c, i) => {
    if (g.strength[i] > 0) (groups.get(c) ?? groups.set(c, []).get(c)!).push(i);
  });
  const kept = [...groups.values()]
    .filter((members) => members.length >= MIN_CONSTELLATION)
    .map((members) => members.sort((a, b) => rank[b] - rank[a] || a - b))
    .sort((a, b) => b.length - a.length || notes[a[0]].id.localeCompare(notes[b[0]].id));

  // Concept frequency across the brain, to find what is distinctive of a group.
  const brainCount = new Map<string, number>();
  for (const n of notes) for (const c of n.concepts ?? []) brainCount.set(c.k, (brainCount.get(c.k) ?? 0) + 1);

  const membership = new Map<string, string>();
  const constellations: Constellation[] = kept.map((members, idx) => {
    const id = `c${idx + 1}`;
    for (const i of members) membership.set(notes[i].id, id);

    const inGroup = new Map<string, { count: number; labels: Map<string, number> }>();
    for (const i of members) {
      for (const c of notes[i].concepts ?? []) {
        const e = inGroup.get(c.k) ?? { count: 0, labels: new Map<string, number>() };
        e.count++;
        e.labels.set(c.l, (e.labels.get(c.l) ?? 0) + 1);
        inGroup.set(c.k, e);
      }
    }
    // Distinctive: frequent in the group, rare elsewhere (TF-IDF at group level).
    const distinctive = [...inGroup.entries()]
      .filter(([, e]) => e.count >= 2)
      .map(([k, e]) => ({
        label: [...e.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
        score: e.count * Math.log((notes.length + 1) / (brainCount.get(k) ?? 1)),
        k,
      }))
      .sort((a, b) => b.score - a.score || a.k.localeCompare(b.k))
      .slice(0, 2);
    const name = distinctive.length
      ? distinctive.map((d) => d.label).join(" · ")
      : clip(notes[members[0]].title, 40);

    return {
      id,
      name,
      noteIds: members.map((i) => notes[i].id),
      color: CONSTELLATION_COLORS[idx % CONSTELLATION_COLORS.length],
    };
  });

  // Core ideas: the most central notes that actually hold something together.
  const degree = g.adj.map((m) => m.size);
  const core = notes
    .map((n, i) => ({ id: n.id, score: rank[i], degree: degree[i] }))
    .filter((x) => x.degree >= 2)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map(({ id, score }) => ({ id, score: Math.round(score * 10_000) / 10_000 }));

  // Bridges: connections spread across constellations.
  const bridges: MindMap["bridges"] = [];
  notes.forEach((n, i) => {
    const byC = new Map<string, number>();
    let total = 0;
    for (const [j, w] of g.adj[i]) {
      const c = membership.get(notes[j].id);
      if (!c) continue;
      byC.set(c, (byC.get(c) ?? 0) + w);
      total += w;
    }
    if (byC.size < 2 || total === 0) return;
    let sq = 0;
    for (const w of byC.values()) sq += (w / total) ** 2;
    const participation = 1 - sq;
    const top = [...byC.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // A bridge joins two universes substantially, not with a stray thread.
    if (participation < 0.3 || top[1][1] < 0.5) return;
    bridges.push({ id: n.id, between: [top[0][0], top[1][0]], participation: Math.round(participation * 1000) / 1000 });
  });
  bridges.sort((a, b) => b.participation - a.participation || a.id.localeCompare(b.id));

  return { constellations, membership, core, bridges: bridges.slice(0, 5), modularity: Math.round(q * 1000) / 1000 };
}
