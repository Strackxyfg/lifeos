import { addMonths, treasury, type BalanceLike, type TxnLike } from "@/lib/finance/treasury";

/**
 * The monthly investor update, built from what the person recorded — and
 * nothing else. Every figure carries its sources: the transactions it adds
 * up, the balance it starts from, the review a highlight comes from. What
 * cannot be said (no balance stated, no complete month, no previous month)
 * is null, and the page says why, instead of a number that would look fine
 * and mean nothing.
 *
 * Deals and projects keep no history of their state: they are reported as
 * they stand today, and labelled so.
 *
 * Pure; tested.
 */

export interface ReportTxn extends TxnLike {
  item: string;
}

export interface ReportInput {
  transactions: ReportTxn[];
  balances: BalanceLike[];
  deals: { id: string; name: string; company: string; stage: string; value: number }[];
  projects: { id: string; name: string; status: string; progress: number }[];
  reviews: { weekStart: string; wins: string; blockers: string; decisions: { text: string; why: string }[] }[];
}

export interface MoneyFact {
  value: number;
  /** The transactions summed. */
  ids: string[];
}

export interface InvestorReport {
  /** YYYY-MM */
  month: string;
  revenue: MoneyFact;
  expenses: MoneyFact;
  net: number;
  previousRevenue: MoneyFact | null;
  /** Revenue change vs the previous month, as a ratio (0.12 = +12 %); null when there is nothing to compare. */
  growth: number | null;
  /** Cash at the end of the month, from a stated balance; null without one. */
  cashEnd: { value: number; anchor: BalanceLike; sinceIds: string[] } | null;
  runwayEnd: { months: number; endsIn: string } | "growing" | null;
  burnMonths: string[];
  pipeline: { open: { count: number; value: number; ids: string[] }; won: { count: number; value: number; ids: string[] } };
  projects: { active: { id: string; name: string; progress: number }[]; done: number; blocked: number; total: number };
  highlights: { weekStart: string; wins: string }[];
  decisions: { weekStart: string; text: string; why: string }[];
  blockers: { weekStart: string; text: string }[];
  /** Transactions with no date: counted nowhere in the update. */
  undated: number;
}

const cents = (x: number) => Math.round(x * 100);

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function sumIn(txns: ReportTxn[], month: string, type: "Income" | "Expense"): MoneyFact {
  const hit = txns.filter((t) => t.type === type && t.occurredOn && t.occurredOn.slice(0, 7) === month);
  return { value: hit.reduce((s, t) => s + cents(t.amount), 0) / 100, ids: hit.map((t) => t.id) };
}

/** The ISO week belongs to the month its Friday falls in — the day the review is written. */
function reviewMonth(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4);
  return d.toISOString().slice(0, 7);
}

export function investorReport(input: ReportInput, month: string): InvestorReport {
  const txns = input.transactions;
  const revenue = sumIn(txns, month, "Income");
  const expenses = sumIn(txns, month, "Expense");
  const prevMonth = addMonths(month, -1);
  const prev = sumIn(txns, prevMonth, "Income");
  const hadPrevious = txns.some((t) => t.occurredOn && t.occurredOn.slice(0, 7) === prevMonth);
  const previousRevenue = hadPrevious ? prev : null;
  const growth = previousRevenue && previousRevenue.value > 0 ? (revenue.value - previousRevenue.value) / previousRevenue.value : null;

  // Cash and runway as they stood at the end of the month: nothing after it
  // is known to them, and the month itself counts in the burn.
  const end = lastDay(month);
  const upToEnd = txns.filter((t) => !t.occurredOn || t.occurredOn <= end);
  const known = input.balances.filter((b) => b.asOf <= end);
  const t = treasury(upToEnd, known, `${addMonths(month, 1)}-01`);
  const cashEnd = t.cash !== null && t.anchor ? { value: t.cash, anchor: t.anchor, sinceIds: t.sinceAnchor.ids } : null;

  const open = input.deals.filter((d) => d.stage !== "Won" && d.stage !== "Lost");
  const won = input.deals.filter((d) => d.stage === "Won");
  const total = (list: { value: number }[]) => list.reduce((s, d) => s + cents(d.value), 0) / 100;

  const reviews = input.reviews.filter((r) => reviewMonth(r.weekStart) === month).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));

  return {
    month,
    revenue,
    expenses,
    net: (cents(revenue.value) - cents(expenses.value)) / 100,
    previousRevenue,
    growth,
    cashEnd,
    runwayEnd: t.runway,
    burnMonths: t.burn?.months.map((m) => m.month) ?? [],
    pipeline: {
      open: { count: open.length, value: total(open), ids: open.map((d) => d.id) },
      won: { count: won.length, value: total(won), ids: won.map((d) => d.id) },
    },
    projects: {
      active: input.projects.filter((p) => p.status === "In progress").map((p) => ({ id: p.id, name: p.name, progress: p.progress })),
      done: input.projects.filter((p) => p.status === "Done").length,
      blocked: input.projects.filter((p) => p.status === "Blocked").length,
      total: input.projects.length,
    },
    highlights: reviews.filter((r) => r.wins.trim()).map((r) => ({ weekStart: r.weekStart, wins: r.wins.trim() })),
    decisions: reviews.flatMap((r) => r.decisions.filter((d) => d.text.trim()).map((d) => ({ weekStart: r.weekStart, text: d.text, why: d.why }))),
    blockers: reviews.filter((r) => r.blockers.trim()).map((r) => ({ weekStart: r.weekStart, text: r.blockers.trim() })),
    undated: txns.filter((x) => !x.occurredOn).length,
  };
}

/** The last month that is over, for a given day (YYYY-MM-DD). */
export function lastCompleteMonth(today: string): string {
  return addMonths(today.slice(0, 7), -1);
}
