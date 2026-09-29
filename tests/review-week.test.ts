import { describe, it, expect } from "vitest";
import { addDays, inWeek, isReviewTime, weekFacts, weekStartOf } from "@/lib/review/week";

describe("the review's week", () => {
  it("starts on Monday, whatever day it is asked from", () => {
    expect(weekStartOf("2026-10-02")).toBe("2026-09-28"); // a Friday
    expect(weekStartOf("2026-09-28")).toBe("2026-09-28"); // the Monday itself
    expect(weekStartOf("2026-10-04")).toBe("2026-09-28"); // the Sunday after
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28"); // across a year
  });

  it("covers seven days, Monday to Sunday", () => {
    expect(inWeek("2026-09-28", "2026-09-28")).toBe(true);
    expect(inWeek("2026-10-04", "2026-09-28")).toBe(true);
    expect(inWeek("2026-10-05", "2026-09-28")).toBe(false);
    expect(inWeek(null, "2026-09-28")).toBe(false);
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("suggests the review from Friday to Sunday", () => {
    expect(isReviewTime("2026-10-02")).toBe(true);
    expect(isReviewTime("2026-10-04")).toBe(true);
    expect(isReviewTime("2026-10-05")).toBe(false);
  });
});

describe("what the week holds", () => {
  const input = {
    notes: [
      { id: "n1", title: "Pricing idea", day: "2026-09-29" },
      { id: "n2", title: "Last week", day: "2026-09-21" },
    ],
    remindersDone: [{ title: "Call Marc", day: "2026-10-01" }],
    transactions: [
      { type: "Income" as const, amount: 1200.1, day: "2026-09-30" },
      { type: "Income" as const, amount: 0.2, day: "2026-10-01" },
      { type: "Expense" as const, amount: 300, day: "2026-10-02" },
      { type: "Expense" as const, amount: 999, day: null },
      { type: "Expense" as const, amount: 50, day: "2026-10-06" },
    ],
    deals: [{ name: "Acme", day: "2026-09-28" }],
    reviews: [
      { weekStart: "2026-09-14", decisions: [{ id: "a", text: "Stop cold outreach", why: "3% reply", revisitOn: "2026-10-01" }] },
      { weekStart: "2026-09-21", decisions: [{ id: "b", text: "Raise prices", why: "", revisitOn: "2026-11-01" }, { id: "c", text: "Hire", why: "", revisitOn: null }] },
      { weekStart: "2026-09-28", decisions: [{ id: "d", text: "This week's own", why: "", revisitOn: "2026-09-30" }] },
    ],
  };

  it("counts only what is dated inside the week, money in cents", () => {
    const f = weekFacts(input, "2026-09-28");
    expect(f.notes).toEqual([{ id: "n1", title: "Pricing idea" }]);
    expect(f.remindersDone).toEqual(["Call Marc"]);
    expect(f.moneyIn).toBe(1200.3);
    expect(f.moneyOut).toBe(300);
    expect(f.transactions).toBe(3);
    expect(f.newDeals).toEqual(["Acme"]);
  });

  it("brings back earlier decisions whose day has come — not later ones, not this week's own", () => {
    const f = weekFacts(input, "2026-09-28");
    expect(f.revisit.map((d) => d.text)).toEqual(["Stop cold outreach"]);
    expect(f.revisit[0].decidedWeek).toBe("2026-09-14");
  });
});
