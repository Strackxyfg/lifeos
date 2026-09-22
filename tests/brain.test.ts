import { describe, it, expect } from "vitest";
import { normalize, tokens, hash } from "@/lib/brain/text";
import {
  canonicalPair, neighborsOf, degreeMap, liveLinks, suggestLinks, sameLink,
  type NoteLike, type LinkLike,
} from "@/lib/brain/graph";
import { computeFocus, ageInDays, FRESH_IDEA_DAYS } from "@/lib/brain/focus";
import { pickResurface, dayKey, RESURFACE_MIN_AGE_DAYS } from "@/lib/brain/resurface";
import { searchNotes } from "@/lib/brain/search";
import { nodePosition, NODE_MIN_RADIUS, NODE_MAX_RADIUS } from "@/lib/brain/layout";
import { toMarkdown, toJson, uniqueTitles, wikiSafe, type ExportNote, type MarkdownLabels } from "@/lib/brain/export";
import type { BrainCategoryId } from "@/lib/data/brain";

const NOW = new Date("2026-09-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function note(id: string, category: BrainCategoryId, title: string, opts: Partial<NoteLike> = {}): NoteLike {
  return { id, category, title, detail: null, done: false, createdAt: daysAgo(1), ...opts };
}
const link = (a: string, b: string): LinkLike => ({ fromId: a, toId: b });

/* ── Text ──────────────────────────────────────────────────────────── */

describe("text", () => {
  it("normalises case and accents", () => {
    expect(normalize("Événement Été À NOËL")).toBe("evenement ete a noel");
  });

  it("drops stopwords in both languages and short words", () => {
    expect(tokens("Pour le lancement de la campagne with the team")).toEqual(["lancement", "campagne", "team"]);
  });

  it("folds plurals so singular and plural match", () => {
    expect(tokens("campagnes")).toEqual(tokens("campagne"));
  });

  it("leaves double-s endings alone", () => {
    expect(tokens("business process")).toEqual(["business", "process"]);
  });

  it("de-duplicates and ignores pure numbers", () => {
    expect(tokens("Budget budget 2026 BUDGET")).toEqual(["budget"]);
  });

  it("hashes deterministically", () => {
    expect(hash("abc")).toBe(hash("abc"));
    expect(hash("abc")).not.toBe(hash("abd"));
    expect(hash("abc")).toBeGreaterThanOrEqual(0);
  });
});

/* ── Graph ─────────────────────────────────────────────────────────── */

describe("graph", () => {
  it("stores a link once whichever way round it is drawn", () => {
    expect(canonicalPair("b", "a")).toEqual(["a", "b"]);
    expect(canonicalPair("a", "b")).toEqual(["a", "b"]);
    expect(sameLink(link("a", "b"), "b", "a")).toBe(true);
  });

  it("orders uuids the way Postgres does, whatever their case", () => {
    // Postgres compares uuid bytes; "a" (0xa) comes before "B" (0xb). Plain
    // string comparison would put "a" after "B" and the database's
    // `check (from_id < to_id)` would reject the insert.
    const lower = "a0000000-0000-4000-8000-000000000000";
    const upper = "B0000000-0000-4000-8000-000000000000";
    expect(canonicalPair(upper, lower)).toEqual([lower, upper.toLowerCase()]);
    expect(canonicalPair(lower, upper)).toEqual([lower, upper.toLowerCase()]);
  });

  it("finds neighbours in both directions", () => {
    const links = [link("a", "b"), link("c", "a"), link("d", "e")];
    expect([...neighborsOf("a", links)].sort()).toEqual(["b", "c"]);
  });

  it("counts degree, orphans absent", () => {
    const d = degreeMap([link("a", "b"), link("a", "c")]);
    expect(d.get("a")).toBe(2);
    expect(d.get("b")).toBe(1);
    expect(d.get("z")).toBeUndefined();
  });

  it("drops links to deleted notes and self-links", () => {
    const notes = [{ id: "a" }, { id: "b" }];
    expect(liveLinks([link("a", "b"), link("a", "gone"), link("a", "a")], notes)).toEqual([link("a", "b")]);
  });
});

describe("link suggestions", () => {
  const corpus = [
    note("t", "ideas", "Campagne LinkedIn pour les freelances"),
    note("r1", "next", "Rédiger les posts LinkedIn de la campagne"),
    note("r2", "knowledge", "Tarifs publicitaires LinkedIn 2026"),
    note("u1", "thoughts", "Penser à réserver les vacances d'été"),
    note("c1", "thoughts", "Le projet avance bien"),
    note("c2", "thoughts", "Nouveau projet de cuisine"),
  ];

  it("finds the related notes", () => {
    const ids = suggestLinks(corpus[0], corpus, []).map((s) => s.id);
    expect(ids).toContain("r1");
    expect(ids).not.toContain("u1");
  });

  it("explains itself with the shared words", () => {
    const top = suggestLinks(corpus[0], corpus, [])[0];
    expect(top.id).toBe("r1");
    expect(top.shared).toEqual(expect.arrayContaining(["linkedin", "campagne"]));
  });

  it("never suggests the note itself or one already linked", () => {
    const ids = suggestLinks(corpus[0], corpus, [link("r1", "t")]).map((s) => s.id);
    expect(ids).not.toContain("t");
    expect(ids).not.toContain("r1");
  });

  it("weighs a rare shared word above a common one", () => {
    // "projet" appears across the corpus; "linkedin" is distinctive.
    const notes = [
      note("x", "ideas", "projet linkedin"),
      note("rare", "ideas", "linkedin"),
      note("common", "ideas", "projet"),
      note("p1", "ideas", "projet a"),
      note("p2", "ideas", "projet b"),
    ];
    const s = suggestLinks(notes[0], notes, [], 5);
    const rank = (id: string) => s.findIndex((x) => x.id === id);
    expect(rank("rare")).toBeGreaterThanOrEqual(0);
    expect(rank("rare")).toBeLessThan(rank("common") === -1 ? Infinity : rank("common"));
  });

  it("returns nothing for a note with no meaningful words", () => {
    expect(suggestLinks(note("e", "ideas", "le la de"), corpus, [])).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const a = suggestLinks(corpus[0], corpus, []);
    const b = suggestLinks(corpus[0], [...corpus].reverse(), []);
    expect(a).toEqual(b);
  });

  it("respects the limit", () => {
    expect(suggestLinks(corpus[0], corpus, [], 1)).toHaveLength(1);
  });
});

describe("link suggestions — calibration on a realistic brain", () => {
  // The corpus the threshold was tuned against. If this starts failing, the
  // threshold or the tokeniser changed what "related" means.
  const brain = [
    note("goal", "goals", "Atteindre 50 clients payants pour LifeOS avant décembre"),
    note("ads", "next", "Lancer une campagne LinkedIn Ads ciblée freelances"),
    note("cases", "next", "Écrire 3 études de cas clients"),
    note("referral", "ideas", "Programme de parrainage : un mois offert par client amené"),
    note("cpc", "knowledge", "Coût par clic LinkedIn Ads en France : 5 à 8 €"),
    note("cake", "knowledge", "Recette du gâteau au chocolat de mamie"),
    note("time", "thoughts", "Les freelances veulent surtout gagner du temps"),
    note("passport", "thoughts", "Penser à renouveler mon passeport"),
  ];
  const suggested = (id: string) => suggestLinks(brain.find((n) => n.id === id)!, brain, [], 5).map((s) => s.id);

  it("connects notes that share one meaningful word", () => {
    expect(suggested("goal")).toEqual(expect.arrayContaining(["cases", "referral"]));
    expect(suggested("ads")).toEqual(expect.arrayContaining(["cpc", "time"]));
  });

  it("connects nothing to notes about something else entirely", () => {
    expect(suggested("cake")).toEqual([]);
    expect(suggested("passport")).toEqual([]);
    for (const id of ["goal", "ads", "cases", "referral", "cpc", "time"]) {
      expect(suggested(id)).not.toContain("cake");
      expect(suggested(id)).not.toContain("passport");
    }
  });

  it("explains with words as written, not folded comparison keys", () => {
    const [s] = suggestLinks(brain.find((n) => n.id === "cases")!, brain, [], 5).filter((x) => x.id === "goal");
    // "clients" is how both notes spell it — not the folded key "client".
    expect(s.shared).toEqual(["clients"]);

    const all = brain.flatMap((n) => suggestLinks(n, brain, [], 5).flatMap((x) => x.shared));
    expect(all).not.toContain("lifeo");
    expect(all).not.toContain("temp");
  });

  it("still connects a note whose long description would dilute the overlap", () => {
    // Found in the browser: a goal with a paragraph under it stopped linking to
    // the step that serves it, because scoring the full text alone let the
    // description drown the one shared word. Titles are compared on their own too.
    const notes = [
      note("goal", "goals", "Reach 50 paying customers by December", {
        detail: "The one number that decides whether this becomes a business, and the benchmark for every plan we make.",
      }),
      note("cases", "next", "Write 3 customer case studies"),
      note("unrelated", "ideas", "Voice capture from the lock screen"),
    ];
    const ids = suggestLinks(notes[0], notes, [], 5).map((s) => s.id);
    expect(ids).toContain("cases");
    expect(ids).not.toContain("unrelated");
  });

  it("never offers filler words like 'one' as the reason", () => {
    const notes = [
      note("a", "goals", "One goal for one customer", { detail: "one one one" }),
      note("b", "ideas", "One idea for a customer"),
    ];
    const all = suggestLinks(notes[0], notes, [], 5).flatMap((s) => s.shared);
    expect(all).not.toContain("one");
    expect(all).toContain("customer");
  });

  it("keeps accents in explanations", () => {
    const withAccent = [note("a", "ideas", "Études de marché"), note("b", "knowledge", "Les études récentes")];
    expect(suggestLinks(withAccent[0], withAccent, [])[0].shared).toEqual(["études"]);
  });
});

/* ── Focus ─────────────────────────────────────────────────────────── */

describe("focus", () => {
  it("computes age in whole days, never negative", () => {
    expect(ageInDays(daysAgo(3), NOW)).toBe(3);
    expect(ageInDays(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe(0);
    expect(ageInDays("not a date", NOW)).toBe(0);
  });

  it("is empty for an empty brain — no invented priorities", () => {
    expect(computeFocus({ notes: [], links: [], now: NOW })).toEqual([]);
  });

  it("ranks the four bands in order, whatever their age", () => {
    const notes = [
      note("goal", "goals", "Lancer en octobre", { createdAt: daysAgo(1) }),
      note("orphanGoal", "goals", "Courir un marathon", { createdAt: daysAgo(1) }),
      note("serving", "next", "Écrire la page de vente", { createdAt: daysAgo(0) }),
      note("waiting", "next", "Répondre à Paul", { createdAt: daysAgo(59) }),
      note("idea", "ideas", "Une idée", { createdAt: daysAgo(0) }),
    ];
    const f = computeFocus({ notes, links: [link("serving", "goal")], now: NOW });
    expect(f.map((e) => e.id)).toEqual(["serving", "orphanGoal", "waiting", "idea"]);
  });

  it("names the goal a next step serves", () => {
    const notes = [note("g", "goals", "Lancer en octobre"), note("s", "next", "Page de vente")];
    const [first] = computeFocus({ notes, links: [link("g", "s")], now: NOW });
    expect(first.reason).toEqual({ code: "servesGoal", goal: "Lancer en octobre", days: 1 });
  });

  it("does not flag a goal that already has an open next step", () => {
    const notes = [note("g", "goals", "Objectif"), note("s", "next", "Étape")];
    const ids = computeFocus({ notes, links: [link("g", "s")], now: NOW }).map((e) => e.id);
    expect(ids).not.toContain("g");
  });

  it("flags a goal again once its only next step is done", () => {
    const notes = [note("g", "goals", "Objectif"), note("s", "next", "Étape", { done: true })];
    const f = computeFocus({ notes, links: [link("g", "s")], now: NOW });
    expect(f).toEqual([{ id: "g", reason: { code: "goalWithoutAction" }, score: 200 }]);
  });

  it("ignores finished work", () => {
    const notes = [note("s", "next", "Fait", { done: true }), note("g", "goals", "Atteint", { done: true })];
    expect(computeFocus({ notes, links: [], now: NOW })).toEqual([]);
  });

  it("only surfaces ideas that are recent and unlinked", () => {
    const notes = [
      note("fresh", "ideas", "Récente", { createdAt: daysAgo(2) }),
      note("stale", "ideas", "Ancienne", { createdAt: daysAgo(FRESH_IDEA_DAYS) }),
      note("linked", "ideas", "Reliée", { createdAt: daysAgo(2) }),
      note("k", "knowledge", "Note"),
    ];
    const ids = computeFocus({ notes, links: [link("linked", "k")], now: NOW }).map((e) => e.id);
    expect(ids).toEqual(["fresh"]);
  });

  it("puts the older of two waiting steps first", () => {
    const notes = [
      note("new", "next", "Récente", { createdAt: daysAgo(1) }),
      note("old", "next", "Ancienne", { createdAt: daysAgo(20) }),
    ];
    expect(computeFocus({ notes, links: [], now: NOW }).map((e) => e.id)).toEqual(["old", "new"]);
  });

  it("is deterministic regardless of input order", () => {
    const notes = [
      note("a", "next", "A", { createdAt: daysAgo(3) }),
      note("b", "next", "B", { createdAt: daysAgo(3) }),
      note("c", "goals", "C"),
    ];
    const one = computeFocus({ notes, links: [], now: NOW });
    const two = computeFocus({ notes: [...notes].reverse(), links: [], now: NOW });
    expect(one).toEqual(two);
  });

  it("respects the limit", () => {
    const notes = Array.from({ length: 12 }, (_, i) => note(`s${i}`, "next", `Étape ${i}`));
    expect(computeFocus({ notes, links: [], now: NOW, limit: 5 })).toHaveLength(5);
  });
});

/* ── Resurfacing ──────────────────────────────────────────────────── */

describe("resurfacing", () => {
  const old = (id: string, category: BrainCategoryId = "knowledge", extra: Partial<NoteLike> = {}) =>
    note(id, category, `Note ${id}`, { createdAt: daysAgo(RESURFACE_MIN_AGE_DAYS + 10), ...extra });

  it("returns nothing when nothing is old enough", () => {
    const notes = [note("a", "knowledge", "Récente", { createdAt: daysAgo(RESURFACE_MIN_AGE_DAYS - 1) })];
    expect(pickResurface({ notes, links: [], now: NOW, seed: "u" })).toBeNull();
  });

  it("never resurfaces to-dos, goals or finished notes", () => {
    const notes = [old("n", "next"), old("g", "goals"), old("d", "knowledge", { done: true })];
    expect(pickResurface({ notes, links: [], now: NOW, seed: "u" })).toBeNull();
  });

  it("is stable within a day", () => {
    const notes = ["a", "b", "c", "d", "e"].map((id) => old(id));
    const morning = pickResurface({ notes, links: [], now: new Date("2026-09-21T06:00:00Z"), seed: "u" });
    const evening = pickResurface({ notes, links: [], now: new Date("2026-09-21T23:00:00Z"), seed: "u" });
    expect(morning?.id).toBe(evening?.id);
  });

  it("rotates across days", () => {
    const notes = ["a", "b", "c", "d", "e", "f"].map((id) => old(id));
    const picks = new Set<string>();
    for (let d = 0; d < 20; d++) {
      const now = new Date(NOW.getTime() + d * 86_400_000);
      picks.add(pickResurface({ notes, links: [], now, seed: "u" })!.id);
    }
    expect(picks.size).toBeGreaterThan(2);
  });

  it("does not depend on the order notes arrive in", () => {
    const notes = ["a", "b", "c", "d"].map((id) => old(id));
    const a = pickResurface({ notes, links: [], now: NOW, seed: "u" });
    const b = pickResurface({ notes: [...notes].reverse(), links: [], now: NOW, seed: "u" });
    expect(a?.id).toBe(b?.id);
  });

  it("brings back orphans more often than connected notes", () => {
    const notes = [old("orphan"), old("hub"), old("n1"), old("n2")];
    const links = [link("hub", "n1"), link("hub", "n2")];
    let orphan = 0;
    let hub = 0;
    for (let d = 0; d < 400; d++) {
      const now = new Date(NOW.getTime() + d * 86_400_000);
      const id = pickResurface({ notes, links, now, seed: "u" })!.id;
      if (id === "orphan") orphan++;
      if (id === "hub") hub++;
    }
    expect(orphan).toBeGreaterThan(hub);
  });

  it("keys the day in UTC", () => {
    expect(dayKey(new Date("2026-09-21T23:30:00Z"))).toBe("2026-09-21");
  });
});

/* ── Search ────────────────────────────────────────────────────────── */

describe("search", () => {
  const notes = [
    note("a", "ideas", "Événement de lancement", { createdAt: daysAgo(3) }),
    note("b", "knowledge", "Notes diverses", { detail: "Le lancement se prépare", createdAt: daysAgo(1) }),
    note("c", "ideas", "Stratégie IA pour 2026"),
    note("d", "thoughts", "LinkedIn Ads"),
  ];

  it("ignores accents in both directions", () => {
    expect(searchNotes(notes, "evenement").map((n) => n.id)).toEqual(["a"]);
    expect(searchNotes(notes, "ÉVÉNEMENT").map((n) => n.id)).toEqual(["a"]);
  });

  it("ranks a title match above a body match", () => {
    expect(searchNotes(notes, "lancement").map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("requires every term", () => {
    expect(searchNotes(notes, "lancement evenement").map((n) => n.id)).toEqual(["a"]);
    expect(searchNotes(notes, "lancement zzz")).toEqual([]);
  });

  it("matches short words and partial words", () => {
    expect(searchNotes(notes, "IA").map((n) => n.id)).toEqual(["c"]);
    expect(searchNotes(notes, "linke").map((n) => n.id)).toEqual(["d"]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchNotes(notes, "   ")).toEqual([]);
  });
});

/* ── Layout ────────────────────────────────────────────────────────── */

describe("3D layout", () => {
  const anchor: [number, number, number] = [1, 0.5, -0.3];
  const dist = (p: number[]) => Math.hypot(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]);

  it("puts a note in the same place every time", () => {
    expect(nodePosition("abc", anchor)).toEqual(nodePosition("abc", anchor));
  });

  it("keeps every note within its region's orbit", () => {
    for (let i = 0; i < 500; i++) {
      const d = dist(nodePosition(`note-${i}`, anchor));
      expect(d).toBeGreaterThanOrEqual(NODE_MIN_RADIUS - 1e-9);
      expect(d).toBeLessThanOrEqual(NODE_MAX_RADIUS + 1e-9);
    }
  });

  it("spreads different notes apart", () => {
    expect(nodePosition("a", anchor)).not.toEqual(nodePosition("b", anchor));
  });
});

/* ── Export ────────────────────────────────────────────────────────── */

describe("export", () => {
  const labels: MarkdownLabels = {
    title: "Second cerveau",
    exportedOn: "Exporté le",
    counts: (n, l) => `${n} notes · ${l} liens`,
    region: { goals: "Objectifs", next: "Prochaines actions", ideas: "Idées", thoughts: "Pensées", knowledge: "Connaissances", insights: "Insights" },
    linkedTo: "Liens :",
    done: "fait",
    todo: "à faire",
  };
  const x = (id: string, category: BrainCategoryId, title: string, extra: Partial<ExportNote> = {}): ExportNote => ({
    ...note(id, category, title),
    kind: "note",
    ai: false,
    concepts: [],
    ...extra,
  });

  it("strips characters Obsidian cannot link to", () => {
    expect(wikiSafe("A [draft] | v2 #tag ^x")).toBe("A draft v2 tag x");
    expect(wikiSafe("  ")).toBe("Untitled");
  });

  it("disambiguates duplicate titles deterministically", () => {
    const t = uniqueTitles([
      x("b", "ideas", "Idée", { createdAt: daysAgo(1) }),
      x("a", "ideas", "idée", { createdAt: daysAgo(5) }),
    ]);
    expect(t.get("a")).toBe("idée");
    expect(t.get("b")).toBe("Idée (2)");
  });

  it("writes regions in order, links both ways, and task state", () => {
    const notes = [
      x("s", "next", "Écrire la page", { done: true }),
      x("g", "goals", "Lancer en octobre", { detail: "Objectif principal." }),
    ];
    const md = toMarkdown(notes, [{ fromId: "s", toId: "g" }], labels, NOW);

    expect(md.indexOf("## Objectifs")).toBeLessThan(md.indexOf("## Prochaines actions"));
    expect(md).toContain("### Lancer en octobre");
    expect(md).toContain("Objectif principal.");
    expect(md).toContain("Liens : [[Écrire la page]]");
    expect(md).toContain("Liens : [[Lancer en octobre]]");
    expect(md).toContain("- [x] fait");
    expect(md).toMatch(/^---\nlifeos_export: 1\n/);
    expect(md).toContain("notes: 2");
    expect(md).toContain("links: 1");
  });

  it("points links at the disambiguated title", () => {
    const notes = [
      x("a", "ideas", "Idée", { createdAt: daysAgo(5) }),
      x("b", "ideas", "Idée", { createdAt: daysAgo(1) }),
      x("c", "knowledge", "Source"),
    ];
    const md = toMarkdown(notes, [{ fromId: "c", toId: "b" }], labels, NOW);
    expect(md).toContain("[[Idée (2)]]");
    expect(md).not.toMatch(/Liens : \[\[Idée\]\]/);
  });

  it("omits empty regions", () => {
    const md = toMarkdown([x("i", "ideas", "Une idée")], [], labels, NOW);
    expect(md).toContain("## Idées");
    expect(md).not.toContain("## Objectifs");
  });

  it("round-trips every field in JSON, with canonical links", () => {
    const notes = [x("z", "ideas", "Z", { ai: true, detail: "d" }), x("a", "goals", "A")];
    const j = toJson(notes, [{ fromId: "z", toId: "a", reason: "lié", origin: "user" }], NOW);
    expect(j.format).toBe("lifeos.brain");
    expect(j.version).toBe(1);
    expect(j.notes.map((n) => n.id)).toEqual(["a", "z"]);
    expect(j.notes[1]).toMatchObject({ ai: true, detail: "d", kind: "note" });
    expect(j.links).toEqual([
      { fromId: "a", toId: "z", reason: "lié", origin: "user", createdAt: null, kind: "related", sourceId: null },
    ]);
    expect(j.notes[1].concepts).toEqual([]);
  });
});

/* ── Capture routing (no-AI fallback) ─────────────────────────────── */

import { heuristicRegion } from "@/lib/brain/classify";

describe("capture routing without AI", () => {
  it("recognises French words whose accents broke the old word-boundary patterns", () => {
    // `\bidée\b` never matched "idée": JS \b sees "é" as a non-word character.
    expect(heuristicRegion("Une idée pour la landing")).toBe("ideas");
    expect(heuristicRegion("Écrire l'article de blog")).toBe("next");
    expect(heuristicRegion("À faire : relancer Paul")).toBe("next");
  });

  it("puts goals before next steps, though goals contain verbs", () => {
    expect(heuristicRegion("Atteindre 50 clients d'ici décembre")).toBe("goals");
    expect(heuristicRegion("Reach 10k MRR by the end of the year")).toBe("goals");
  });

  it("routes the other regions", () => {
    expect(heuristicRegion("What if we offered a free tier?")).toBe("ideas");
    expect(heuristicRegion("Selon l'INSEE, 1 actif sur 10 est indépendant")).toBe("knowledge");
    expect(heuristicRegion("J'ai compris que la vitesse compte plus que le prix")).toBe("insights");
  });

  it("falls back to thoughts", () => {
    expect(heuristicRegion("Journée calme aujourd'hui")).toBe("thoughts");
  });
});

/* ── Assistant context ────────────────────────────────────────────── */

import { buildBrainContext, type ContextLabels } from "@/lib/brain/context";

describe("assistant context", () => {
  const labels: ContextLabels = {
    about: "About",
    name: "Name:",
    work: "Work:",
    areas: "Areas:",
    goals: "Goals",
    focus: "Focus",
    relevant: "Relevant",
    recent: "Recent",
    empty: "EMPTY",
    reason: (r) => r.code,
    relation: (kind, side) => `${kind}/${side}`,
  };
  const brain = [
    note("g", "goals", "Atteindre 50 clients payants d'ici décembre", { createdAt: daysAgo(20) }),
    note("cases", "next", "Écrire 3 études de cas clients", { createdAt: daysAgo(5) }),
    note("cpc", "knowledge", "Coût par clic LinkedIn Ads en France : 5 à 8 €", { detail: "Source : campagne test de mars.", createdAt: daysAgo(30) }),
    note("cake", "knowledge", "Recette du gâteau au chocolat", { createdAt: daysAgo(40) }),
    note("done", "goals", "Lancer la bêta", { done: true, createdAt: daysAgo(60) }),
  ];
  const ctx = (question: string, budget?: number) =>
    buildBrainContext({ notes: brain, links: [], question, now: NOW, labels, budget });

  it("says so when the brain is empty, rather than inventing context", () => {
    expect(buildBrainContext({ notes: [], links: [], question: "x", now: NOW, labels })).toBe("EMPTY");
  });

  it("always includes open goals, never finished ones", () => {
    const c = ctx("bonjour");
    expect(c).toContain("Atteindre 50 clients payants");
    expect(c).not.toContain("Lancer la bêta");
  });

  it("pulls in the notes relevant to the question, with their detail", () => {
    const c = ctx("Combien coûte un clic sur LinkedIn ?");
    expect(c).toContain("## Relevant");
    expect(c).toContain("Coût par clic LinkedIn Ads");
    expect(c).toContain("Source : campagne test de mars.");
  });

  it("does not pull in unrelated notes as relevant", () => {
    const c = ctx("Combien coûte un clic sur LinkedIn ?");
    const relevant = c.split("## Relevant")[1]?.split("##")[0] ?? "";
    expect(relevant).not.toContain("gâteau");
  });

  it("lists a note once, in its highest-priority section", () => {
    const c = ctx("Atteindre des clients payants");
    expect(c.match(/Atteindre 50 clients payants/g)).toHaveLength(1);
  });

  it("stays within budget, dropping the lowest-priority sections first", () => {
    const c = ctx("LinkedIn", 120);
    expect(c.length).toBeLessThanOrEqual(120);
    expect(c).toContain("## Goals");
  });

  const person = { name: "Camille", profession: "Fondatrice d'une agence", areas: ["Clients & ventes"] };

  it("starts with who the person is", () => {
    const c = buildBrainContext({ notes: brain, links: [], question: "x", now: NOW, labels, person });
    expect(c.startsWith("## About\n- Name: Camille\n- Work: Fondatrice d'une agence\n- Areas: Clients & ventes")).toBe(true);
  });

  it("keeps who they are when the budget forces sections out", () => {
    const c = buildBrainContext({ notes: brain, links: [], question: "LinkedIn", now: NOW, labels, person, budget: 150 });
    expect(c.length).toBeLessThanOrEqual(150);
    expect(c).toContain("Camille");
  });

  it("knows the person even before they have written a note", () => {
    const c = buildBrainContext({ notes: [], links: [], question: "x", now: NOW, labels, person });
    expect(c).toContain("Camille");
    expect(c).toContain("EMPTY");
  });

  it("leaves out what the profile does not say, rather than inventing it", () => {
    const c = buildBrainContext({ notes: brain, links: [], question: "x", now: NOW, labels, person: { areas: [] } });
    expect(c).not.toContain("## About");
  });
});

/* ── What the agent reads through MCP ─────────────────────────────── */

import { brainIndex, brainSearch } from "@/lib/brain/agent-views";

describe("agent views of the brain", () => {
  const brain = [
    note("g1", "goals", "Atteindre 50 clients", { detail: "Le chiffre qui décide." }),
    note("n1", "next", "Écrire 3 études de cas"),
    note("n2", "next", "Ancienne tâche", { done: true }),
    note("k1", "knowledge", "Coût par clic LinkedIn", { detail: "5 à 8 € en France." }),
  ];
  const links = [link("g1", "n1")];

  it("gives the agent real content, not just permission", () => {
    const idx = brainIndex(brain, links);
    expect(idx).toContain("[g1] Atteindre 50 clients");
    expect(idx).toContain("Le chiffre qui décide.");
    expect(idx).toContain("[k1] Coût par clic LinkedIn");
  });

  it("includes ids and link counts, so the agent can connect notes", () => {
    const idx = brainIndex(brain, links);
    expect(idx).toContain("[n1] Écrire 3 études de cas · 1 link");
  });

  it("leaves finished notes out of the index but counts them", () => {
    const idx = brainIndex(brain, links);
    expect(idx).not.toContain("Ancienne tâche");
    expect(idx).toContain("3 open notes, 1 done");
  });

  it("stays within its size limit and says what it left out", () => {
    const many = Array.from({ length: 400 }, (_, i) => note(`x${i}`, "ideas", `Idée numéro ${i} assez longue pour peser`));
    const idx = brainIndex(many, [], 2_000);
    expect(idx.length).toBeLessThanOrEqual(2_200);
    expect(idx).toMatch(/more not shown — use brain_search/);
  });

  it("returns full text and connections for a search", () => {
    const r = brainSearch(brain, links, "linkedin");
    expect(r).toContain("[k1] Coût par clic LinkedIn");
    expect(r).toContain("5 à 8 € en France.");
    const s = brainSearch(brain, links, "études");
    expect(s).toContain('"Atteindre 50 clients"');
    expect(s).toContain("Connections:\n- related to [g1]");
  });

  it("says so when nothing matches, or the brain is empty", () => {
    expect(brainSearch(brain, links, "zzz")).toMatch(/No note matches/);
    expect(brainIndex([], [])).toMatch(/empty/);
  });
});
