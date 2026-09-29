import { describe, it, expect } from "vitest";
import { investorReport, lastCompleteMonth, type ReportInput } from "@/lib/report/investor";

const input: ReportInput = {
  transactions: [
    { id: "a", item: "Stripe July", type: "Income", amount: 4000, occurredOn: "2026-07-31" },
    { id: "b", item: "Stripe Aug", type: "Income", amount: 5000, occurredOn: "2026-08-15" },
    { id: "c", item: "Contractor", type: "Expense", amount: 7000.5, occurredOn: "2026-08-20" },
    { id: "d", item: "Tools", type: "Expense", amount: 500, occurredOn: "2026-08-02" },
    { id: "e", item: "Stripe Sep", type: "Income", amount: 6000, occurredOn: "2026-09-03" },
    { id: "f", item: "Old invoice", type: "Income", amount: 999, occurredOn: null },
    { id: "g", item: "July rent", type: "Expense", amount: 6000, occurredOn: "2026-07-05" },
  ],
  balances: [
    { id: "b1", amount: 30000, asOf: "2026-07-31" },
    { id: "b2", amount: 99999, asOf: "2026-09-15" },
  ],
  deals: [
    { id: "d1", name: "Acme pilot", company: "Acme", stage: "Proposal", value: 24000 },
    { id: "d2", name: "Globex", company: "Globex", stage: "Won", value: 12000 },
    { id: "d3", name: "Initech", company: "Initech", stage: "Lost", value: 5000 },
  ],
  projects: [
    { id: "p1", name: "Onboarding v2", status: "In progress", progress: 60 },
    { id: "p2", name: "Launch page", status: "Done", progress: 100 },
    { id: "p3", name: "Deck", status: "Blocked", progress: 30 },
  ],
  reviews: [
    { weekStart: "2026-08-03", wins: "Signed Globex", blockers: "", decisions: [{ text: "Focus on SMBs", why: "Shorter cycles" }] },
    { weekStart: "2026-08-24", wins: "", blockers: "Hiring a designer", decisions: [] },
    // Its Friday is 4 September: a September week.
    { weekStart: "2026-08-31", wins: "September win", blockers: "", decisions: [] },
  ],
};

describe("the investor update", () => {
  const r = investorReport(input, "2026-08");

  it("sums the month's dated transactions, and says which ones", () => {
    expect(r.revenue).toEqual({ value: 5000, ids: ["b"] });
    expect(r.expenses).toEqual({ value: 7500.5, ids: ["c", "d"] });
    expect(r.net).toBe(-2500.5);
    expect(r.undated).toBe(1);
  });

  it("compares with the previous month only when there is one", () => {
    expect(r.previousRevenue).toEqual({ value: 4000, ids: ["a"] });
    expect(r.growth).toBeCloseTo(0.25, 10);
    const first = investorReport(input, "2026-06");
    expect(first.previousRevenue).toBeNull();
    expect(first.growth).toBeNull();
  });

  it("gives the cash at month end from the balance stated before it — never a later one", () => {
    expect(r.cashEnd?.anchor.id).toBe("b1");
    expect(r.cashEnd?.value).toBe(30000 + 5000 - 7500.5);
    expect(r.cashEnd?.sinceIds.sort()).toEqual(["b", "c", "d"]);
  });

  it("counts the month itself in the burn, and nothing after it", () => {
    expect(r.burnMonths).toEqual(["2026-07", "2026-08"]);
    // (−2000 − 2500.5) / 2 = −2250.25 per month; 27499.5 / 2250.25 = 12.2
    expect(r.runwayEnd).toEqual({ months: 12.2, endsIn: "2027-09" });
  });

  it("reports deals and projects as they stand, not as they were", () => {
    expect(r.pipeline.open).toEqual({ count: 1, value: 24000, ids: ["d1"] });
    expect(r.pipeline.won).toEqual({ count: 1, value: 12000, ids: ["d2"] });
    expect(r.projects).toEqual({ active: [{ id: "p1", name: "Onboarding v2", progress: 60 }], done: 1, blocked: 1, total: 3 });
  });

  it("takes highlights, decisions and blockers from the month's Friday reviews", () => {
    expect(r.highlights).toEqual([{ weekStart: "2026-08-03", wins: "Signed Globex" }]);
    expect(r.decisions).toEqual([{ weekStart: "2026-08-03", text: "Focus on SMBs", why: "Shorter cycles" }]);
    expect(r.blockers).toEqual([{ weekStart: "2026-08-24", text: "Hiring a designer" }]);
  });

  it("has no cash without a stated balance", () => {
    const none = investorReport({ ...input, balances: [] }, "2026-08");
    expect(none.cashEnd).toBeNull();
    expect(none.runwayEnd).toBeNull();
  });

  it("defaults to the last month that is over", () => {
    expect(lastCompleteMonth("2026-09-29")).toBe("2026-08");
    expect(lastCompleteMonth("2027-01-02")).toBe("2026-12");
  });
});
