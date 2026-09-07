import { describe, it, expect } from "vitest";
import { buildSnapshot, projects, transactions, deals, todayTasks } from "@/lib/data/workspace";
import { computeInsight, snapshotFacts, insightPrompt } from "@/lib/ai/insights";

describe("buildSnapshot", () => {
  const s = buildSnapshot();

  it("counts projects by status consistently", () => {
    expect(s.projects.total).toBe(projects.length);
    expect(s.projects.inProgress + s.projects.blocked + s.projects.done + s.projects.planning).toBe(
      projects.length
    );
  });

  it("lists the blocked projects by name", () => {
    const expected = projects.filter((p) => p.status === "Blocked").map((p) => p.name);
    expect(s.projects.blockedNames).toEqual(expected);
  });

  it("averages progress within bounds", () => {
    expect(s.projects.avgProgress).toBeGreaterThanOrEqual(0);
    expect(s.projects.avgProgress).toBeLessThanOrEqual(100);
  });

  it("computes finance net as income minus expenses", () => {
    const income = transactions.filter((t) => t.type === "Income").reduce((a, t) => a + t.amount, 0);
    const expense = transactions.filter((t) => t.type === "Expense").reduce((a, t) => a + t.amount, 0);
    expect(s.finance.income).toBe(income);
    expect(s.finance.expense).toBe(expense);
    expect(s.finance.net).toBe(income - expense);
  });

  it("excludes won/lost deals from open pipeline", () => {
    const open = deals.filter((d) => d.stage !== "Won" && d.stage !== "Lost");
    expect(s.crm.openCount).toBe(open.length);
    expect(s.crm.openValue).toBe(open.reduce((a, d) => a + d.value, 0));
  });

  it("splits today's tasks into done and open", () => {
    expect(s.tasks.done + s.tasks.open).toBe(todayTasks.length);
  });

  it("never surfaces completed projects as needing attention", () => {
    const doneNames = projects.filter((p) => p.status === "Done").map((p) => p.name);
    for (const item of s.projects.dueSoon) {
      expect(doneNames).not.toContain(item.name);
    }
  });
});

describe("computeInsight (no-key fallback)", () => {
  const s = buildSnapshot();

  for (const locale of ["en", "fr"] as const) {
    for (const kind of ["daily", "weekly"] as const) {
      it(`produces a complete ${kind} insight in ${locale}`, () => {
        const i = computeInsight(kind, s, locale);
        expect(i.headline.length).toBeGreaterThan(0);
        expect(i.body.length).toBeGreaterThan(20);
        expect(i.actions).toHaveLength(3);
        expect(i.actions.every((a) => a.trim().length > 0)).toBe(true);
        expect(i.source).toBe("computed");
        expect(Number.isNaN(Date.parse(i.generatedAt))).toBe(false);
      });
    }
  }

  it("cites the real blocked project rather than inventing one", () => {
    const blocked = s.projects.blockedNames[0];
    const i = computeInsight("weekly", s, "en");
    if (blocked) expect(i.body).toContain(blocked);
  });

  it("differs between locales", () => {
    expect(computeInsight("weekly", s, "fr").body).not.toBe(
      computeInsight("weekly", s, "en").body
    );
  });
});

describe("prompt construction", () => {
  it("passes real figures to the model", () => {
    const facts = snapshotFacts(buildSnapshot(), "en");
    expect(facts).toContain("Projects:");
    expect(facts).toContain("Finance:");
    expect(facts).toContain("Pipeline:");
  });

  it("pins the output language and JSON shape", () => {
    expect(insightPrompt("weekly", "fr")).toContain("French");
    expect(insightPrompt("daily", "en")).toContain("English");
    expect(insightPrompt("daily", "en")).toContain("headline");
  });
});
