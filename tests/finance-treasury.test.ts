import { describe, it, expect } from "vitest";
import { proposeDate, isoDate } from "@/lib/finance/dates";
import { addMonths, monthlyFlows, treasury, type TxnLike } from "@/lib/finance/treasury";

describe("reading a transaction's date", () => {
  it("takes full dates as they are, in any common form", () => {
    expect(proposeDate("2026-07-26", "2026-09-29")).toEqual({ date: "2026-07-26", certainty: "exact" });
    expect(proposeDate("26/07/2026", "2026-09-29")).toEqual({ date: "2026-07-26", certainty: "exact" });
    expect(proposeDate("26 juillet 2026", "2026-09-29")).toEqual({ date: "2026-07-26", certainty: "exact" });
    expect(proposeDate("July 26, 2026", "2026-09-29")).toEqual({ date: "2026-07-26", certainty: "exact" });
    expect(proposeDate("le 3 sept. 2025", "2026-09-29")).toEqual({ date: "2025-09-03", certainty: "exact" });
    expect(proposeDate("1er août 2026", "2026-09-29")).toEqual({ date: "2026-08-01", certainty: "exact" });
  });

  it("infers the year only as the latest such day before the entry was recorded, and says so", () => {
    expect(proposeDate("Jul 26", "2026-09-29")).toEqual({ date: "2026-07-26", certainty: "inferred-year" });
    // Recorded in January: "Dec 20" was last year.
    expect(proposeDate("Dec 20", "2026-01-10")).toEqual({ date: "2025-12-20", certainty: "inferred-year" });
    expect(proposeDate("26/07", "2026-09-29")).toEqual({ date: "2026-07-26", certainty: "inferred-year" });
  });

  it("reads day-first by default and month-first when asked, unless the numbers decide", () => {
    expect(proposeDate("03/04/2026", "2026-09-29")?.date).toBe("2026-04-03");
    expect(proposeDate("03/04/2026", "2026-09-29", false)?.date).toBe("2026-03-04");
    expect(proposeDate("13/04/2026", "2026-09-29", false)?.date).toBe("2026-04-13");
  });

  it("refuses what is not a real day, and what it cannot read", () => {
    expect(proposeDate("30/02/2026", "2026-09-29")).toBeNull();
    expect(proposeDate("Feb 30", "2026-09-29")).toBeNull();
    expect(proposeDate("last tuesday", "2026-09-29")).toBeNull();
    expect(proposeDate("", "2026-09-29")).toBeNull();
    expect(proposeDate("Q3", "2026-09-29")).toBeNull();
    expect(isoDate(2026, 2, 29)).toBeNull();
    expect(isoDate(2028, 2, 29)).toBe("2028-02-29");
  });

  it("finds the last 29 February for a leap day without a year", () => {
    expect(proposeDate("29 Feb", "2026-09-29")).toEqual({ date: "2024-02-29", certainty: "inferred-year" });
  });
});

const tx = (id: string, type: "Income" | "Expense", amount: number, occurredOn: string | null): TxnLike => ({ id, type, amount, occurredOn });

describe("the treasury", () => {
  const txns = [
    tx("a", "Income", 5000, "2026-06-10"),
    tx("b", "Expense", 9000, "2026-06-15"),
    tx("c", "Income", 4000, "2026-07-05"),
    tx("d", "Expense", 8000, "2026-07-20"),
    tx("e", "Income", 3000, "2026-08-02"),
    tx("f", "Expense", 7000, "2026-08-25"),
    tx("g", "Expense", 1000, "2026-09-12"),
    tx("h", "Income", 500, null),
  ];
  const balances = [
    { id: "b1", amount: 50000, asOf: "2026-08-31" },
    { id: "b0", amount: 60000, asOf: "2026-05-31" },
  ];

  it("carries the latest stated balance forward with the dated movements after it", () => {
    const t = treasury(txns, balances, "2026-09-29");
    expect(t.anchor?.id).toBe("b1");
    expect(t.cash).toBe(49000);
    expect(t.sinceAnchor).toEqual({ net: -1000, ids: ["g"] });
    expect(t.undated).toBe(1);
  });

  it("averages the burn over the last three complete months", () => {
    const t = treasury(txns, balances, "2026-09-29");
    expect(t.burn?.months.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    // (−4000 − 4000 − 4000) / 3
    expect(t.burn?.averageNet).toBe(-4000);
    expect(t.runway).toEqual({ months: 12.2, endsIn: "2027-09" });
  });

  it("does not count this month, which is not over", () => {
    const t = treasury(txns, balances, "2026-09-29");
    expect(t.burn?.months.some((m) => m.month === "2026-09")).toBe(false);
  });

  it("only looks back as far as the records go, and counts a quiet month as zero", () => {
    const short = [tx("x", "Expense", 3000, "2026-07-03"), tx("y", "Expense", 1000, "2026-09-02")];
    const t = treasury(short, [{ id: "b", amount: 10000, asOf: "2026-07-01" }], "2026-09-15");
    expect(t.burn?.months.map((m) => [m.month, m.net])).toEqual([
      ["2026-07", -3000],
      ["2026-08", 0],
    ]);
    expect(t.burn?.averageNet).toBe(-1500);
  });

  it("says nothing about burn before a complete month is recorded", () => {
    const t = treasury([tx("x", "Expense", 100, "2026-09-02")], [{ id: "b", amount: 1000, asOf: "2026-09-01" }], "2026-09-20");
    expect(t.burn).toBeNull();
    expect(t.runway).toBeNull();
    expect(t.cash).toBe(900);
  });

  it("calls a business that earns more than it spends growing, not immortal", () => {
    const t = treasury([tx("x", "Income", 5000, "2026-08-10"), tx("y", "Expense", 1000, "2026-08-11")], [{ id: "b", amount: 1000, asOf: "2026-08-01" }], "2026-09-05");
    expect(t.runway).toBe("growing");
  });

  it("gives no cash and no runway without a stated balance — never a guessed one", () => {
    const t = treasury(txns, [], "2026-09-29");
    expect(t.cash).toBeNull();
    expect(t.runway).toBeNull();
    expect(t.burn).not.toBeNull();
  });

  it("ignores balances stated for the future and keeps future movements out of today's cash", () => {
    const t = treasury([tx("z", "Expense", 500, "2026-10-15")], [{ id: "late", amount: 1, asOf: "2026-12-31" }, { id: "now", amount: 2000, asOf: "2026-09-01" }], "2026-09-29");
    expect(t.anchor?.id).toBe("now");
    expect(t.cash).toBe(2000);
    expect(t.future).toBe(1);
  });

  it("adds money exactly, in cents", () => {
    const t = treasury([tx("p", "Income", 0.1, "2026-09-10"), tx("q", "Income", 0.2, "2026-09-11")], [{ id: "b", amount: 0, asOf: "2026-09-01" }], "2026-09-29");
    expect(t.cash).toBe(0.3);
  });

  it("groups by month and walks months across years", () => {
    const flows = monthlyFlows(txns);
    expect(flows.get("2026-06")).toEqual({ month: "2026-06", income: 5000, expense: 9000, net: -4000, ids: ["a", "b"] });
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});
