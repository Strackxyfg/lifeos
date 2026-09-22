import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/ai/json";
import {
  conceptOverlap, conceptIdf, conceptTerms, contentHash, sanitizeConcepts, themes, type Concept,
} from "@/lib/brain/concepts";
import { pairKey, suggestLinks, toBrainLink, type LinkLike, type NoteLike } from "@/lib/brain/graph";
import { perspective, sourceOf } from "@/lib/brain/relations";
import { AUTO_LINK, parseVerdicts, planLinks, rankPairs, type PairCandidate, type Verdict } from "@/lib/brain/weave";
import { computeFocus } from "@/lib/brain/focus";
import { groundAnswer, type ContextLabels } from "@/lib/brain/context";
import { searchNotes } from "@/lib/brain/search";
import { brainRelated, brainSearch } from "@/lib/brain/agent-views";
import { toMarkdown, type MarkdownLabels } from "@/lib/brain/export";
import type { BrainCategoryId } from "@/lib/data/brain";

const NOW = new Date("2026-09-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const c = (k: string, l = k): Concept => ({ k, l });
function note(id: string, category: BrainCategoryId, title: string, opts: Partial<NoteLike> = {}): NoteLike {
  return { id, category, title, detail: null, done: false, createdAt: daysAgo(1), concepts: [], ...opts };
}

/* ── Relations ────────────────────────────────────────────────────── */

describe("relations", () => {
  const goal = note("g", "goals", "Goal", { createdAt: daysAgo(10) });
  const step = note("s", "next", "Step", { createdAt: daysAgo(2) });
  const fact = note("k", "knowledge", "Fact", { createdAt: daysAgo(20) });
  const older = note("i1", "ideas", "Idea 1", { createdAt: daysAgo(9) });
  const newer = note("i2", "ideas", "Idea 2", { createdAt: daysAgo(1) });

  it("keeps an explicit direction when it names one of the two notes", () => {
    expect(sourceOf("advances", goal, step, "g")).toBe("g");
    expect(sourceOf("advances", goal, step, "elsewhere")).toBe("s"); // ignored, inferred instead
  });

  it("infers the direction from what the notes are", () => {
    expect(sourceOf("advances", goal, step)).toBe("s"); // the step moves the goal forward
    expect(sourceOf("supports", goal, fact)).toBe("k"); // the fact backs the goal
    expect(sourceOf("extends", older, newer)).toBe("i2"); // the later note develops the earlier
  });

  it("gives symmetric relations no direction", () => {
    expect(sourceOf("tension", goal, step, "s")).toBeNull();
    expect(sourceOf("related", goal, step)).toBeNull();
  });

  it("reads a relation from each side", () => {
    expect(perspective("advances", "s", "s")).toBe("out");
    expect(perspective("advances", "g", "s")).toBe("in");
    expect(perspective("tension", "g", null)).toBe("both");
    expect(perspective("advances", "g", null)).toBe("both");
  });

  it("reads rows written before relations had kinds as plain, undirected connections", () => {
    const old = toBrainLink({ id: "1", fromId: "a", toId: "b", reason: null, origin: "suggested" });
    expect(old).toEqual({ id: "1", fromId: "a", toId: "b", reason: null, origin: "suggested", kind: "related", sourceId: null });
  });

  it("never trusts a malformed row", () => {
    const l = toBrainLink({ id: "1", fromId: "a", toId: "b", origin: "robot", kind: "loves", sourceId: "zzz" });
    expect(l).toMatchObject({ origin: "user", kind: "related", sourceId: null });
    // A direction outside the pair, or on a symmetric kind, is dropped.
    expect(toBrainLink({ id: "2", fromId: "a", toId: "b", kind: "advances", sourceId: "c" }).sourceId).toBeNull();
    expect(toBrainLink({ id: "3", fromId: "a", toId: "b", kind: "tension", sourceId: "a" }).sourceId).toBeNull();
    expect(toBrainLink({ id: "4", fromId: "a", toId: "b", kind: "advances", sourceId: "B" }).sourceId).toBe("b");
  });
});

/* ── Concepts ─────────────────────────────────────────────────────── */

describe("concepts", () => {
  it("keeps specific concepts and drops generic, empty and repeated ones", () => {
    expect(
      sanitizeConcepts([
        { k: "Referral  Programs!", l: "Parrainage" },
        "LinkedIn Ads",
        { k: "business", l: "affaires" },
        { k: "idea" },
        { k: "  " },
        { k: "2026" },
        { k: "referral programs", l: "doublon" },
        { key: "cash flow", label: "trésorerie" },
      ])
    ).toEqual([c("referral programs", "Parrainage"), c("linkedin ads", "LinkedIn Ads"), c("cash flow", "trésorerie")]);
  });

  it("returns nothing for anything that is not a list, and caps the count", () => {
    expect(sanitizeConcepts("referral")).toEqual([]);
    expect(sanitizeConcepts(null)).toEqual([]);
    expect(sanitizeConcepts(Array.from({ length: 12 }, (_, i) => `topic ${String.fromCharCode(97 + i)}`))).toHaveLength(6);
  });

  it("fingerprints the words, not the spacing or the case", () => {
    expect(contentHash("Relancer  Marc", null)).toBe(contentHash("relancer marc", ""));
    expect(contentHash("Relancer Marc", null)).not.toBe(contentHash("Relancer Paul", null));
    expect(contentHash("A", "detail")).not.toBe(contentHash("A", null));
  });

  it("compares multi-word concepts word by word as well as whole", () => {
    expect(conceptTerms([c("running schedule"), c("vat")])).toEqual(["running schedule", "running", "schedule", "vat"]);
  });

  it("connects notes written in two languages through their shared concept", () => {
    const fr = [c("referral program", "programme de parrainage"), c("client acquisition", "acquisition clients")];
    const en = [c("referral program", "referral program"), c("paid ads", "paid ads")];
    const idf = conceptIdf([{ id: "fr", concepts: fr }, { id: "en", concepts: en }]);
    const o = conceptOverlap(fr, en, idf);
    expect(o.score).toBeGreaterThan(0.2);
    // Labelled in the first note's words.
    expect(o.shared.map((x) => x.l)).toEqual(["programme de parrainage"]);
  });

  it("finds a partial match between a plan and the goal it prepares", () => {
    const plan = [c("running schedule", "planning course")];
    const goal = [c("semi-marathon"), c("running", "course à pied")];
    const o = conceptOverlap(plan, goal, conceptIdf([{ id: "p", concepts: plan }, { id: "g", concepts: goal }]));
    expect(o.score).toBeGreaterThan(0.2);
    expect(o.shared[0].l).toBe("planning course");
  });

  it("surfaces the subjects the person keeps coming back to", () => {
    const t = themes([
      { id: "1", done: false, concepts: [c("referral program", "parrainage")] },
      { id: "2", done: false, concepts: [c("referral program", "parrainage"), c("pricing", "prix")] },
      { id: "3", done: false, concepts: [c("referral program", "referral")] },
      { id: "4", done: true, concepts: [c("pricing", "prix")] },
      { id: "5", done: false, concepts: [c("pricing", "prix")] },
    ]);
    expect(t.map((x) => [x.key, x.label, x.noteIds.length])).toEqual([
      ["referral program", "parrainage", 3], // the majority label wins
      ["pricing", "prix", 2], // the finished note does not count
    ]);
  });
});

/* ── Suggestions, with concepts ───────────────────────────────────── */

describe("suggestions with concepts", () => {
  const fr = note("fr", "ideas", "Programme de parrainage", { concepts: [c("referral program", "parrainage")] });
  const en = note("en", "knowledge", "Referrals convert better than ads", { concepts: [c("referral program", "referral program")] });
  const other = note("x", "thoughts", "Passeport à renouveler", { concepts: [c("passport", "passeport")] });

  it("suggests notes that share no word but the same subject", () => {
    const s = suggestLinks(fr, [fr, en, other], []);
    expect(s.map((x) => x.id)).toEqual(["en"]);
    expect(s[0]).toMatchObject({ via: "concepts", shared: ["parrainage"] });
  });

  it("never suggests a pair the person said is unrelated", () => {
    expect(suggestLinks(fr, [fr, en, other], [], 3, new Set([pairKey("en", "fr")]))).toEqual([]);
  });
});

/* ── Which pairs to ask about ─────────────────────────────────────── */

describe("choosing pairs for the model", () => {
  const brain = [
    note("g1", "goals", "Signer 10 clients", { createdAt: daysAgo(20) }),
    note("g2", "goals", "Courir un semi-marathon", { createdAt: daysAgo(18), concepts: [c("running")] }),
    note("s1", "next", "Relancer Marc mardi", { createdAt: daysAgo(3) }),
    note("s4", "next", "Réserver des créneaux de course", { createdAt: daysAgo(1), concepts: [c("running schedule")] }),
    note("i1", "ideas", "Programme de parrainage clients", { createdAt: daysAgo(4) }),
    note("old", "next", "Envoyer la facture", { createdAt: daysAgo(40), done: true }),
  ];

  it("always asks whether a new note serves a goal, even with no word in common", () => {
    const pairs = rankPairs({ notes: brain, links: [], dismissed: new Set(), focusIds: ["s1"], limit: 10 });
    expect(pairs.map((p) => p.b)).toEqual(expect.arrayContaining(["g1", "g2"]));
    expect(pairs.every((p) => p.a === "s1")).toBe(true);
  });

  it("skips pairs already connected, dismissed, or involving finished notes", () => {
    const pairs = rankPairs({
      notes: brain,
      links: [{ fromId: "g1", toId: "s1" }],
      dismissed: new Set([pairKey("s1", "g2")]),
      focusIds: ["s1"],
      limit: 10,
    });
    const keys = pairs.map((p) => pairKey(p.a, p.b));
    expect(keys).not.toContain(pairKey("s1", "g1"));
    expect(keys).not.toContain(pairKey("s1", "g2"));
    expect(pairs.some((p) => p.b === "old")).toBe(false);
  });

  it("gives every focused note a share of the limit", () => {
    const pairs = rankPairs({ notes: brain, links: [], dismissed: new Set(), focusIds: ["s1", "s4", "i1"], limit: 3 });
    expect(new Set(pairs.map((p) => p.a))).toEqual(new Set(["s1", "s4", "i1"]));
  });

  it("puts a plan with its goal first when weaving the whole brain", () => {
    const pairs = rankPairs({ notes: brain, links: [], dismissed: new Set(), limit: 12 });
    const keys = pairs.map((p) => pairKey(p.a, p.b));
    expect(keys).toContain(pairKey("s4", "g2"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deterministic", () => {
    const run = () => rankPairs({ notes: brain, links: [], dismissed: new Set(), limit: 12 });
    expect(run()).toEqual(run());
  });
});

/* ── Reading the model ────────────────────────────────────────────── */

describe("reading a model's JSON", () => {
  it("finds the JSON after reasoning, inside fences, next to prose", () => {
    expect(extractJson('<think>maybe {"no": 1}</think>\n{"ok": true}')).toEqual({ ok: true });
    expect(extractJson('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Here you go: {"reason": "a } inside a string"} thanks')).toEqual({ reason: "a } inside a string" });
    expect(extractJson("[1, 2]")).toEqual([1, 2]);
  });

  it("returns null for anything unreadable, including an unfinished thought", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson('<think>still thinking {"a": 1}')).toBeNull();
    expect(extractJson('{"a": ')).toBeNull();
  });
});

describe("verdicts", () => {
  it("validates everything the model says", () => {
    const raw = JSON.stringify({
      verdicts: [
        { pair: 1, connect: true, kind: "advances", from: "a", confidence: 85, reason: '  "Moves it forward"  ' },
        { pair: 1, connect: true, kind: "tension", confidence: 0.9, reason: "duplicate — ignored" },
        { pair: 2, connect: true, kind: "loves", from: "B", confidence: 0.9, reason: "unknown kind" },
        { pair: 3, connect: "true", kind: "tension", from: "A", confidence: "0.7", reason: "x".repeat(300) },
        { pair: 9, connect: true, kind: "related", confidence: 1, reason: "no such pair" },
        { pair: 4, connect: false },
        "garbage",
      ],
    });
    const v = parseVerdicts(raw, 4);
    expect(v).toHaveLength(4);
    expect(v[0]).toEqual({ pair: 1, connect: true, kind: "advances", from: "A", confidence: 0.85, reason: "Moves it forward" });
    expect(v[1]).toMatchObject({ pair: 2, kind: "related", from: null });
    expect(v[2]).toMatchObject({ pair: 3, connect: true, kind: "tension", from: null, confidence: 0.7 });
    expect(v[2].reason.length).toBeLessThanOrEqual(160);
    expect(v[3]).toMatchObject({ pair: 4, connect: false });
  });

  it("accepts a bare list, and nothing at all", () => {
    expect(parseVerdicts('[{"pair":1,"connect":false}]', 1)).toHaveLength(1);
    expect(parseVerdicts("the model refused", 3)).toEqual([]);
  });
});

describe("planning connections", () => {
  const notes = [
    note("g", "goals", "Goal", { createdAt: daysAgo(10) }),
    note("s", "next", "Step", { createdAt: daysAgo(1) }),
    note("k", "knowledge", "Fact", { createdAt: daysAgo(30) }),
    note("t", "thoughts", "Worry"),
  ];
  const pairs: PairCandidate[] = [
    { a: "s", b: "g", score: 0, via: "goal" },
    { a: "k", b: "g", score: 0.3, via: "concepts" },
    { a: "t", b: "g", score: 0.1, via: "words" },
    { a: "t", b: "s", score: 0.1, via: "words" },
  ];
  const v = (pair: number, extra: Partial<Verdict>): Verdict => ({
    pair, connect: true, kind: "related", from: null, confidence: 0.9, reason: "because", ...extra,
  });

  it("keeps only confident verdicts, and asks more of a plain 'related'", () => {
    const plan = planLinks(pairs, [
      v(1, { kind: "advances", from: "A", confidence: AUTO_LINK.min }),
      v(2, { kind: "related", confidence: AUTO_LINK.min }), // below the stricter bar for "related"
      v(3, { kind: "tension", confidence: AUTO_LINK.min - 0.01 }),
      v(4, { connect: false }),
    ], notes);
    expect(plan.map((p) => [p.a, p.b, p.kind])).toEqual([["s", "g", "advances"]]);
  });

  it("resolves the direction from the verdict, or from the notes when it has none", () => {
    const plan = planLinks(pairs, [
      v(1, { kind: "advances", from: "A" }),
      v(2, { kind: "supports", from: null, confidence: 0.95 }),
    ], notes);
    const byPair = Object.fromEntries(plan.map((p) => [`${p.a}-${p.b}`, p.sourceId]));
    expect(byPair["s-g"]).toBe("s");
    expect(byPair["k-g"]).toBe("k");
  });

  it("draws nothing without a reason the person can read", () => {
    expect(planLinks(pairs, [v(1, { kind: "advances", reason: "" })], notes)).toEqual([]);
  });

  it("caps connections per note and per run, strongest first", () => {
    const plan = planLinks(
      pairs,
      [v(1, { confidence: 0.86 }), v(2, { confidence: 0.99 }), v(3, { confidence: 0.95 }), v(4, { confidence: 0.9 })],
      notes,
      { ...AUTO_LINK, perNote: 2, total: 3 }
    );
    expect(plan.map((p) => `${p.a}-${p.b}`)).toEqual(["k-g", "t-g", "t-s"]);
  });
});

/* ── What connections change elsewhere ────────────────────────────── */

describe("focus with typed connections", () => {
  const goal = note("g", "goals", "Run a half-marathon", { createdAt: daysAgo(5) });
  const step = note("s", "next", "Work late every evening", { createdAt: daysAgo(2) });
  const idea = note("i", "ideas", "Train at lunch", { createdAt: daysAgo(1) });

  it("does not count a step in tension with a goal as serving it", () => {
    const links: LinkLike[] = [{ fromId: "g", toId: "s", kind: "tension" }, { fromId: "g", toId: "i", kind: "tension" }];
    const focus = computeFocus({ notes: [goal, step, idea], links, now: NOW });
    const reason = (id: string) => focus.find((f) => f.id === id)?.reason.code;
    expect(reason("s")).toBe("waiting");
    expect(reason("g")).toBe("goalWithoutAction");
    // Connected, even if in tension: no longer a loose idea.
    expect(reason("i")).toBeUndefined();
  });

  it("still counts a step that advances the goal", () => {
    const focus = computeFocus({ notes: [goal, step], links: [{ fromId: "g", toId: "s", kind: "advances", sourceId: "s" }], now: NOW });
    expect(focus[0]).toMatchObject({ id: "s", reason: { code: "servesGoal", goal: "Run a half-marathon" } });
  });
});

describe("grounding follows connections", () => {
  const labels: ContextLabels = {
    about: "About", name: "Name:", work: "Work:", areas: "Areas:", goals: "Goals", focus: "Focus",
    relevant: "Relevant", recent: "Recent", empty: "EMPTY", reason: (r) => r.code,
    relation: (kind, side) => `${kind}/${side}`,
  };
  const notes = [
    note("ads", "ideas", "Tester LinkedIn Ads pour les freelances"),
    note("cpc", "knowledge", "Un clic coûte 5 à 8 €", { createdAt: daysAgo(30) }),
    note("cake", "knowledge", "Recette du gâteau"),
  ];
  const links: LinkLike[] = [{ fromId: "ads", toId: "cpc", kind: "supports", sourceId: "cpc", reason: "Le coût décide du budget." }];

  it("brings in what a relevant note is connected to, with why", () => {
    const g = groundAnswer({ notes, links, question: "Faut-il tester LinkedIn Ads ?", now: NOW, labels });
    expect(g.text).toContain("↳ supports/in: Un clic coûte 5 à 8 € — Le coût décide du budget.");
    // Unrelated notes may appear as recent context, never as relevant.
    const relevant = g.text.split("## Relevant")[1]?.split("\n## ")[0] ?? "";
    expect(relevant).not.toContain("gâteau");
    expect(g.sources).not.toContain("cake");
    expect(g.sources.slice(0, 2)).toEqual(["ads", "cpc"]);
  });

  it("cites the focus list only when nothing matches the question", () => {
    const step = note("s", "next", "Relancer Marc", { createdAt: daysAgo(3) });
    const matched = groundAnswer({ notes: [...notes, step], links, question: "LinkedIn Ads ?", now: NOW, labels });
    expect(matched.sources).not.toContain("s");
    const unmatched = groundAnswer({ notes: [...notes, step], links, question: "Bonjour", now: NOW, labels });
    expect(unmatched.sources).toContain("s");
  });
});

describe("search by subject", () => {
  it("finds a note by its concepts, in either language", () => {
    const notes = [note("fr", "ideas", "Programme de parrainage", { concepts: [c("referral program", "parrainage")] })];
    expect(searchNotes(notes, "referral").map((n) => n.id)).toEqual(["fr"]);
  });
});

describe("what the agent reads", () => {
  const notes = [
    note("g1", "goals", "Signer 10 clients"),
    note("s1", "next", "Relancer Marc"),
    note("i1", "ideas", "Programme de parrainage clients"),
    note("i2", "ideas", "Parrainage : un mois offert aux clients"),
  ];
  const links: LinkLike[] = [
    { fromId: "g1", toId: "s1", kind: "advances", sourceId: "s1", origin: "ai", reason: "Marc est un prospect chaud." },
  ];

  it("shows each connection's meaning, direction, reason and review state", () => {
    const r = brainRelated(notes, links, "g1");
    expect(r).toContain('moved forward by [s1] "Relancer Marc" — Marc est un prospect chaud. (awaiting owner review)');
    expect(brainSearch(notes, links, "Relancer")).toContain('moves forward [g1] "Signer 10 clients"');
  });

  it("offers related notes to connect, except those the owner dismissed", () => {
    expect(brainRelated(notes, links, "i1")).toContain("[i2]");
    expect(brainRelated(notes, links, "i1", new Set([pairKey("i1", "i2")]))).not.toContain("[i2]");
  });

  it("says so for an unknown id", () => {
    expect(brainRelated(notes, links, "nope")).toMatch(/No note has the id/);
  });
});

describe("export of typed connections", () => {
  const labels: MarkdownLabels = {
    title: "Brain", exportedOn: "Exported on", counts: (n, l) => `${n}/${l}`,
    region: { goals: "Goals", next: "Next", ideas: "Ideas", thoughts: "Thoughts", knowledge: "Knowledge", insights: "Insights" },
    linkedTo: "Connections:", done: "done", todo: "to do",
    relation: (kind, side) => `${kind}:${side}`,
  };
  const x = (id: string, category: BrainCategoryId, title: string) => ({ ...note(id, category, title), kind: "note" as const, ai: false, concepts: [] });

  it("says what each connection means, from each side", () => {
    const md = toMarkdown(
      [x("g", "goals", "Goal"), x("s", "next", "Step"), x("r", "ideas", "Other")],
      [{ fromId: "g", toId: "s", kind: "advances", sourceId: "s" }, { fromId: "g", toId: "r" }],
      labels,
      NOW
    );
    expect(md).toContain("Connections: [[Other]] · [[Step]] (advances:in)");
    expect(md).toContain("Connections: [[Goal]] (advances:out)");
  });
});
