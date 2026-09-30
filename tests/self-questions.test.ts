import { describe, expect, it } from "vitest";
import { BANK, BANK_SIZE, followUps, isQuestionId, questionsFor } from "@/lib/self/questions";
import { DIMENSIONS, type Dimension } from "@/lib/self/portrait";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { NoteLike } from "@/lib/brain/graph";

const zero = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;
const now = new Date("2026-09-30T10:00:00Z");
const note = (id: string, category: NoteLike["category"], daysAgo: number, done = false): NoteLike => ({
  id,
  category,
  title: `Note ${id}`,
  done,
  createdAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
});

describe("the question bank", () => {
  it("asks every dimension the same number of questions, each written in both languages", () => {
    expect(BANK).toHaveLength(DIMENSIONS.length * BANK_SIZE);
    for (const q of BANK) {
      const en = (dictionaries.en.self.questions as Record<string, string>)[q.id];
      const fr = (dictionaries.fr.self.questions as Record<string, string>)[q.id];
      expect(en, q.id).toMatch(/\?$/);
      expect(fr, q.id).toMatch(/ \?$/); // French puts a space before the question mark
      expect(fr).not.toBe(en);
    }
    expect(Object.keys(dictionaries.en.self.questions)).toHaveLength(BANK.length);
  });

  it("never assumes the reader's gender in French", () => {
    for (const q of Object.values(dictionaries.fr.self.questions)) expect(q).not.toMatch(/\(e\)|·e|\bfier\b|\bfière\b|\bsenti\b|\bpris\b/);
  });
});

describe("today's questions", () => {
  const base = { day: "2026-09-30", seed: "someone", coverage: zero, answered: new Set<string>() };

  it("asks the same questions all day, and different ones another day", () => {
    const a = questionsFor(base).map((q) => q.id);
    expect(questionsFor(base).map((q) => q.id)).toEqual(a);
    expect(questionsFor({ ...base, day: "2026-10-01" }).map((q) => q.id)).not.toEqual(a);
  });

  it("asks first where the double knows least", () => {
    const coverage = { ...zero, values: 3, drives: 2, strengths: 2, obstacles: 1, rhythms: 2, principles: 2, people: 2, interests: 2 };
    expect(questionsFor({ ...base, coverage })[0].dimension).toBe("obstacles");
  });

  it("moves to another dimension with each new question", () => {
    const qs = questionsFor({ ...base, limit: DIMENSIONS.length });
    expect(new Set(qs.map((q) => q.dimension)).size).toBe(DIMENSIONS.length);
  });

  it("never asks a question already answered, and runs out gracefully", () => {
    const answered = new Set(BANK.slice(0, BANK.length - 1).map((q) => q.id));
    const left = questionsFor({ ...base, answered });
    expect(left.map((q) => q.id)).toEqual([BANK[BANK.length - 1].id]);
    expect(questionsFor({ ...base, answered: new Set(BANK.map((q) => q.id)) })).toEqual([]);
  });

  it("puts a follow-up on their own life first", () => {
    const fu = followUps({ notes: [note("g", "goals", 10)], links: [], now, answered: new Set() });
    const qs = questionsFor({ ...base, followUps: fu });
    expect(qs[0]).toMatchObject({ kind: "goal", id: "goal:g", noteId: "g" });
    expect(qs.slice(1).every((q) => q.kind === "bank")).toBe(true);
  });
});

describe("follow-ups", () => {
  it("asks about a goal left a week without a next step — not a new one, not one with a step, not one done", () => {
    const notes = [note("old", "goals", 10), note("new", "goals", 2), note("stepped", "goals", 30), note("s", "next", 3), note("done", "goals", 30, true)];
    const links = [{ fromId: "s", toId: "stepped", kind: "advances" as const }];
    const ids = followUps({ notes, links, now, answered: new Set() }).map((q) => q.id);
    expect(ids).toEqual(["goal:old"]);
  });

  it("a step in tension with a goal is not a way forward for it", () => {
    const notes = [note("g", "goals", 10), note("s", "next", 3)];
    const links = [{ fromId: "g", toId: "s", kind: "tension" as const }];
    expect(followUps({ notes, links, now, answered: new Set() }).map((q) => q.id)).toContain("goal:g");
  });

  it("asks about an open tension between two live notes, once", () => {
    const notes = [note("a", "ideas", 5), note("b", "ideas", 5)];
    const links = [{ id: "L1", fromId: "a", toId: "b", kind: "tension" as const }];
    expect(followUps({ notes, links, now, answered: new Set() })).toEqual([
      { id: "tension:L1", kind: "tension", dimension: "values", linkId: "L1", a: { id: "a", title: "Note a" }, b: { id: "b", title: "Note b" } },
    ]);
    expect(followUps({ notes, links, now, answered: new Set(["tension:L1"]) })).toEqual([]);
    expect(followUps({ notes, links: [{ ...links[0], resolvedBy: "d" }], now, answered: new Set() })).toEqual([]);
  });
});

describe("question ids from the page", () => {
  it("accepts the bank's and the follow-ups', nothing else", () => {
    expect(isQuestionId("values-1")).toBe(true);
    expect(isQuestionId("goal:3f2a9c1e-0000-4000-8000-000000000001")).toBe(true);
    expect(isQuestionId("tension:abc")).toBe(true);
    expect(isQuestionId("values-99")).toBe(false);
    expect(isQuestionId("goal:<script>")).toBe(false);
    expect(isQuestionId(42)).toBe(false);
  });
});
