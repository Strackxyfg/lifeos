import { describe, expect, it } from "vitest";
import {
  afterNoteChange,
  coverage,
  likeness,
  mergeEvidence,
  notesToRead,
  portraitOf,
  quoteIn,
  sanitizeEvidence,
  sanitizeTraits,
  traitKey,
  type ExtractionContext,
  type TraitLike,
} from "@/lib/self/portrait";

const trait = (over: Partial<TraitLike> & { id: string; statement: string }): TraitLike => ({
  dimension: "rhythms",
  evidence: [],
  status: "proposed",
  origin: "ai",
  key: traitKey(over.statement),
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  ...over,
});

const notes = {
  n1: { id: "note-1", text: "Je travaille mieux le matin, avant 10h.\nAprès le déjeuner je suis lent." },
  n2: { id: "note-2", text: "Marc, mon associé, m'aide à voir clair quand je doute." },
  n3: { id: "note-3", text: "Lancer le podcast\nPeut-être en janvier" },
};
const ctx = (all: TraitLike[] = [], known: TraitLike[] = []): ExtractionContext => ({
  notes: new Map(Object.entries(notes)),
  known: new Map(known.map((t, i) => [`t${i + 1}`, t])),
  all,
});

describe("what counts as their words", () => {
  it("finds a quote whatever the case, accents and punctuation", () => {
    expect(quoteIn("je travaille mieux le MATIN", notes.n1.text)).toBe(true);
    expect(quoteIn("Je travaille mieux le matin, avant 10h", notes.n1.text)).toBe(true);
    expect(quoteIn("apres le dejeuner je suis lent", notes.n1.text)).toBe(true);
  });

  it("refuses words that are not there, or not whole", () => {
    expect(quoteIn("je travaille mieux le soir", notes.n1.text)).toBe(false);
    // "travail" is inside "travaille", but not a word of the note.
    expect(quoteIn("je travail mieux", notes.n1.text)).toBe(false);
  });

  it("needs three words: a fragment proves nothing", () => {
    expect(quoteIn("le matin", notes.n1.text)).toBe(false);
    expect(quoteIn("mieux le matin", notes.n1.text)).toBe(true);
  });

  it("accepts fragments joined by an ellipsis, each found", () => {
    expect(quoteIn("Je travaille mieux… je suis lent", notes.n1.text)).toBe(true);
    expect(quoteIn("Je travaille mieux... je suis rapide", notes.n1.text)).toBe(false);
  });
});

describe("reading the model's answer", () => {
  it("keeps a trait whose quote is really in the note it cites, with the note's real id", () => {
    const out = sanitizeTraits(
      { traits: [{ dimension: "rhythms", statement: "Vous travaillez mieux le matin", evidence: [{ note: "n1", quote: "Je travaille mieux le matin" }] }] },
      ctx()
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].evidence).toEqual([{ noteId: "note-1", quote: "Je travaille mieux le matin" }]);
    expect(out.proposals[0].key).toBe(traitKey("Vous travaillez mieux le matin"));
  });

  it("drops a trait whose quote was invented, or cites a note it was not shown", () => {
    const out = sanitizeTraits(
      {
        traits: [
          { dimension: "values", statement: "Vous tenez à votre famille avant tout", evidence: [{ note: "n2", quote: "ma famille avant tout" }] },
          { dimension: "values", statement: "Vous aimez la clarté dans vos décisions", evidence: [{ note: "n9", quote: "m'aide à voir clair" }] },
        ],
      },
      ctx()
    );
    expect(out.proposals).toEqual([]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["unquoted", "unquoted"]);
  });

  it("drops what is not a trait: unknown dimension, empty statement, special categories it was told not to use", () => {
    const out = sanitizeTraits(
      {
        traits: [
          { dimension: "religion", statement: "Vous êtes croyant", evidence: [{ note: "n1", quote: "Je travaille mieux le matin" }] },
          { dimension: "rhythms", statement: "  ", evidence: [{ note: "n1", quote: "Je travaille mieux le matin" }] },
          "nonsense",
          null,
        ],
      },
      ctx()
    );
    expect(out.proposals).toEqual([]);
  });

  it("never proposes again what was rejected — reworded, or in another dimension", () => {
    const rejected = trait({ id: "r1", statement: "Vous travaillez mieux le matin", status: "rejected", dimension: "rhythms" });
    const out = sanitizeTraits(
      {
        traits: [
          { dimension: "rhythms", statement: "Vous travaillez beaucoup mieux le matin", evidence: [{ note: "n1", quote: "Je travaille mieux le matin" }] },
          { dimension: "strengths", statement: "Vous travaillez mieux le matin", evidence: [{ note: "n1", quote: "Je travaille mieux le matin" }] },
        ],
      },
      ctx([rejected])
    );
    expect(out.proposals).toEqual([]);
    expect(out.dropped.every((d) => d.reason === "rejected-before")).toBe(true);
  });

  it("adds evidence to a trait already held instead of proposing it twice", () => {
    const held = trait({ id: "tr-1", statement: "Vous travaillez mieux le matin", evidence: [{ noteId: "note-9", quote: "le matin je suis efficace" }] });
    const out = sanitizeTraits(
      {
        traits: [
          { dimension: "rhythms", statement: "Vous travaillez mieux le matin", evidence: [{ note: "n1", quote: "Je travaille mieux le matin" }] },
          { existing: "t1", evidence: [{ note: "n1", quote: "Après le déjeuner je suis lent" }] },
        ],
      },
      ctx([held], [held])
    );
    expect(out.proposals).toEqual([]);
    expect(out.support).toEqual([
      {
        traitId: "tr-1",
        evidence: [
          { noteId: "note-1", quote: "Je travaille mieux le matin" },
          { noteId: "note-1", quote: "Après le déjeuner je suis lent" },
        ],
      },
    ]);
  });

  it("merges the same trait said twice in one answer, and caps what one reading proposes", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      dimension: "people",
      statement: `Marc compte pour vous numéro ${"abcdefghijkl"[i]}${"mnopqrstuvwx"[i]} dans un domaine ${i}`,
      evidence: [{ note: "n2", quote: "Marc, mon associé, m'aide" }],
    }));
    const twice = sanitizeTraits(
      {
        traits: [
          { dimension: "people", statement: "Marc, votre associé, vous aide à voir clair", evidence: [{ note: "n2", quote: "Marc, mon associé" }] },
          { dimension: "people", statement: "Marc, votre associé, vous aide à voir clair", evidence: [{ note: "n2", quote: "m'aide à voir clair quand je doute" }] },
        ],
      },
      ctx()
    );
    expect(twice.proposals).toHaveLength(1);
    expect(twice.proposals[0].evidence).toHaveLength(2);
    expect(sanitizeTraits({ traits: many }, ctx()).proposals.length).toBeLessThanOrEqual(8);
  });

  it("sets aside a French statement that gives them a gender, and keeps the turn that needs none", () => {
    const say = (statement: string) =>
      sanitizeTraits({ traits: [{ dimension: "interests", statement, evidence: [{ note: "n2", quote: "Marc, mon associé, m'aide" }] }] }, ctx());
    for (const s of ["Vous êtes intéressé par l'entrepreneuriat", "Vous êtes très organisée", "Vous êtes passionnés de voile"]) {
      expect(say(s).proposals, s).toEqual([]);
      expect(say(s).dropped[0].reason).toBe("gendered");
    }
    for (const s of ["L'entrepreneuriat vous intéresse", "Vous êtes à l'aise à l'oral", "Vous êtes efficace le matin", "Vous aimez le travail bien fait"]) {
      expect(say(s).proposals, s).toHaveLength(1);
    }
  });

  it("never throws on garbage", () => {
    for (const raw of [null, undefined, 42, "x", [], {}, { traits: "no" }, { traits: [{ evidence: "no" }] }]) {
      expect(() => sanitizeTraits(raw, ctx())).not.toThrow();
    }
  });
});

describe("keeping it true", () => {
  const a = trait({ id: "a", statement: "Vous travaillez mieux le matin", evidence: [{ noteId: "note-1", quote: "Je travaille mieux le matin" }] });
  const b = trait({
    id: "b",
    statement: "Marc vous aide",
    status: "confirmed",
    dimension: "people",
    evidence: [{ noteId: "note-2", quote: "Marc, mon associé" }, { noteId: "note-1", quote: "Je travaille mieux le matin" }],
  });
  const r = trait({ id: "r", statement: "Vous êtes lent", status: "rejected", evidence: [{ noteId: "note-1", quote: "je suis lent" }] });

  it("drops a deleted note's quotes; a proposal or a rejection left with nothing goes; a confirmed trait stays", () => {
    const c = afterNoteChange([a, b, r], "note-1", null);
    expect(c.remove.sort()).toEqual(["a", "r"]);
    expect(c.update).toEqual([{ id: "b", evidence: [{ noteId: "note-2", quote: "Marc, mon associé" }] }]);
  });

  it("keeps the quotes a rewritten note still holds, and only those", () => {
    const c = afterNoteChange([a, b], "note-1", "Je travaille mieux le matin, c'est sûr.");
    expect(c).toEqual({ update: [], remove: [] });
    const d = afterNoteChange([a], "note-1", "Finalement je travaille mieux le soir.");
    expect(d.remove).toEqual(["a"]);
  });

  it("shows no proposal whose quotes are gone, and checks quotes against the notes as they are", () => {
    const view = portraitOf([a, b, r], [{ id: "note-2", title: "Marc, mon associé, m'aide", detail: null }]);
    expect(view.rhythms).toEqual([]);
    expect(view.people.map((t) => t.id)).toEqual(["b"]);
    expect(view.people[0].quotes).toEqual([{ noteId: "note-2", quote: "Marc, mon associé", title: "Marc, mon associé, m'aide" }]);
  });

  it("does not count a quote from a note a model wrote", () => {
    const view = portraitOf([a], [{ id: "note-1", title: "Je travaille mieux le matin", detail: null, ai: true }]);
    expect(view.rhythms).toEqual([]);
  });

  it("puts confirmed traits first, then the best supported", () => {
    const x = trait({ id: "x", statement: "Un", dimension: "values", status: "proposed", evidence: [{ noteId: "n", quote: "un deux trois" }, { noteId: "n", quote: "quatre cinq six" }] });
    const y = trait({ id: "y", statement: "Deux", dimension: "values", status: "confirmed", origin: "person" });
    const view = portraitOf([x, y], [{ id: "n", title: "un deux trois quatre cinq six", detail: null }]);
    expect(view.values.map((t) => t.id)).toEqual(["y", "x"]);
  });

  it("counts what it knows per dimension: a confirmed trait one, a proposal half, a rejection nothing", () => {
    const cov = coverage([a, b, r]);
    expect(cov.rhythms).toBe(0.5);
    expect(cov.people).toBe(1);
    expect(cov.values).toBe(0);
  });

  it("merges quotes without repeats, and caps them", () => {
    const e = (q: string) => ({ noteId: "n", quote: q });
    expect(mergeEvidence([e("Un deux trois")], [e("un, deux, trois"), e("quatre cinq six")])).toHaveLength(2);
    expect(mergeEvidence([], Array.from({ length: 20 }, (_, i) => e(`mot ${i} encore ${i}`)))).toHaveLength(8);
  });

  it("validates stored evidence", () => {
    expect(sanitizeEvidence([{ noteId: "n", quote: "a b c" }, { noteId: 3 }, null, "x"])).toEqual([{ noteId: "n", quote: "a b c" }]);
    expect(sanitizeEvidence("nope")).toEqual([]);
  });
});

describe("which notes the double reads", () => {
  const n = (id: string, category: string, createdAt: string, title = `Note ${id} avec assez de mots`) => ({ id, category, title, detail: null, createdAt, done: false });
  it("reads what says most about the person first, and what it has not quoted yet", () => {
    const list = [n("t", "next", "2026-09-10"), n("a", "thoughts", "2026-09-01"), n("b", "insights", "2026-09-02"), n("q", "thoughts", "2026-09-03")];
    const quoted = trait({ id: "z", statement: "x y z", evidence: [{ noteId: "q", quote: "a b c" }] });
    const order = notesToRead(list, [quoted]).map((x) => x.id);
    expect(order.indexOf("t")).toBe(order.length - 1);
    expect(order.indexOf("q")).toBeGreaterThan(order.indexOf("a"));
  });

  it("never reads a model's words as theirs, even in a note they kept", () => {
    const theirs = { ...n("mine", "thoughts", "2026-09-01"), ai: false };
    const models = { ...n("model", "next", "2026-09-02"), ai: true };
    expect(notesToRead([theirs, models], []).map((x) => x.id)).toEqual(["mine"]);
    expect(notesToRead([theirs, models], [], { only: ["model"] })).toEqual([]);
  });

  it("reads only the notes asked, when asked", () => {
    expect(notesToRead([n("a", "thoughts", "2026-09-01"), n("b", "thoughts", "2026-09-02")], [], { only: ["b"] }).map((x) => x.id)).toEqual(["b"]);
  });

  it("recognises the same trait said differently", () => {
    expect(likeness("Vous travaillez mieux le matin", "Vous travaillez beaucoup mieux le matin")).toBeGreaterThanOrEqual(0.6);
    expect(likeness("Vous travaillez mieux le matin", "Marc est votre associé")).toBe(0);
  });
});
