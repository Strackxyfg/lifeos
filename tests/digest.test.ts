import { describe, it, expect } from "vitest";
import { buildSnapshot } from "@/lib/data/workspace";
import { computeInsight, insightPrompt } from "@/lib/ai/insights";
import { brainDigest, digestFacts } from "@/lib/brain/digest";
import type { LinkLike, NoteLike } from "@/lib/brain/graph";
import type { BrainCategoryId } from "@/lib/data/brain";

const NOW = new Date("2026-09-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const note = (id: string, category: BrainCategoryId, title: string, age = 1, done = false): NoteLike => ({
  id, category, title, detail: null, done, createdAt: daysAgo(age),
});

const notes = [
  note("g1", "goals", "Signer 10 nouveaux clients", 20),
  note("g2", "goals", "Courir un semi-marathon", 18),
  note("s1", "next", "Relancer Marc mardi", 3),
  note("t1", "thoughts", "Plus le temps de m'entraîner le soir", 2),
  note("old", "knowledge", "Une vieille note", 40),
];
const links: (LinkLike & { createdAt?: string })[] = [
  { fromId: "g1", toId: "s1", kind: "advances", sourceId: "s1", origin: "user", createdAt: daysAgo(3) },
  { fromId: "g2", toId: "t1", kind: "tension", origin: "ai", reason: "Le temps manque", createdAt: daysAgo(1) },
  { fromId: "g1", toId: "old", kind: "supports", sourceId: "old", origin: "suggested", createdAt: daysAgo(30) },
];

describe("brain digest", () => {
  const d = brainDigest({ notes, links, now: NOW });

  it("summarises what matters now and this week, from the notes themselves", () => {
    expect(d.focus[0]).toMatchObject({ title: "Relancer Marc mardi", reason: { code: "servesGoal" } });
    expect(d.openGoals).toBe(2);
    expect(d.goalsWithoutStep).toEqual(["Courir un semi-marathon"]);
    expect(d.tensions).toEqual([{ a: "Courir un semi-marathon", b: "Plus le temps de m'entraîner le soir", reason: "Le temps manque" }]);
    expect(d.capturedThisWeek).toBe(2);
    expect(d.connectedThisWeek).toBe(2);
    expect(d.awaitingReview).toBe(1);
  });

  it("gives the model the person's own titles, verbatim", () => {
    const facts = digestFacts(d, (r) => r.code);
    expect(facts).toContain('"Relancer Marc mardi" — servesGoal');
    expect(facts).toContain('Goals with no next step: "Courir un semi-marathon"');
    expect(facts).toContain('"Courir un semi-marathon" vs "Plus le temps de m\'entraîner le soir" (Le temps manque)');
    expect(facts).toContain("2 notes captured, 2 connections drawn, 1 awaiting the owner's review.");
  });
});

describe("briefings start from the second brain", () => {
  const s = buildSnapshot();
  const d = brainDigest({ notes, links, now: NOW });

  for (const locale of ["en", "fr"] as const) {
    it(`daily (${locale}): leads with the focus and names the tension`, () => {
      const i = computeInsight("daily", s, locale, d);
      expect(i.source).toBe("computed");
      expect(i.headline).toContain("Relancer Marc mardi");
      expect(i.body).toContain("Plus le temps de m'entraîner le soir");
      expect(i.actions).toHaveLength(3);
      expect(i.actions[0]).toBe("Relancer Marc mardi.");
    });

    it(`weekly (${locale}): counts the week, and asks for the missing next step`, () => {
      const i = computeInsight("weekly", s, locale, d);
      expect(i.headline).toMatch(/^2 notes, 2 (connections|connexions)/);
      expect(i.body).toContain("Courir un semi-marathon");
      expect(i.actions[0]).toMatch(/Courir un semi-marathon/);
      expect(i.actions).toHaveLength(3);
    });
  }

  it("falls back to the workspace when the brain has nothing to say", () => {
    const empty = brainDigest({ notes: [], links: [], now: NOW });
    expect(computeInsight("daily", s, "en", empty)).toEqual({
      ...computeInsight("daily", s, "en"),
      generatedAt: expect.any(String),
    });
  });

  it("tells the model the brain comes first", () => {
    expect(insightPrompt("daily", "fr")).toMatch(/second brain's focus/);
    expect(insightPrompt("weekly", "en")).toMatch(/goals have no next step/);
  });
});
