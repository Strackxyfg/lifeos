/**
 * Cash, burn and runway — from what the person recorded, nothing else.
 *
 * The treasury starts from a balance the person stated ("on 30 September,
 * 42 000 in the bank") and is carried forward by the *dated* transactions
 * after that day. The burn is the average monthly net over the last
 * complete months (up to three) that the records cover; the runway, the
 * cash divided by that burn. Undated transactions are counted and reported,
 * never silently assumed.
 *
 * Every figure keeps its sources — the balance it started from, the ids of
 * the transactions it adds up — so a report can say where each number comes
 * from. Pure; the tests pin every rule.
 */

export interface TxnLike {
  id: string;
  type: "Income" | "Expense";
  amount: number;
  /** YYYY-MM-DD, or null/undefined when not yet dated. */
  occurredOn?: string | null;
}

export interface BalanceLike {
  id: string;
  amount: number;
  asOf: string;
}

export interface MonthFlow {
  /** YYYY-MM */
  month: string;
  income: number;
  expense: number;
  net: number;
  /** The transactions it adds up. */
  ids: string[];
}

/** Money is summed in cents: 0.1 + 0.2 must be 0.3 in a ledger. */
const cents = (x: number) => Math.round(x * 100);
const fromCents = (c: number) => c / 100;

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The month `n` months after `month` (YYYY-MM), n may be negative. */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/** Income, expense and net per calendar month, for dated transactions only. */
export function monthlyFlows(txns: readonly TxnLike[]): Map<string, MonthFlow> {
  const acc = new Map<string, { inc: number; exp: number; ids: string[] }>();
  for (const t of txns) {
    if (!t.occurredOn) continue;
    const key = monthOf(t.occurredOn);
    const row = acc.get(key) ?? { inc: 0, exp: 0, ids: [] };
    if (t.type === "Income") row.inc += cents(t.amount);
    else row.exp += cents(t.amount);
    row.ids.push(t.id);
    acc.set(key, row);
  }
  const out = new Map<string, MonthFlow>();
  for (const [month, r] of acc) out.set(month, { month, income: fromCents(r.inc), expense: fromCents(r.exp), net: fromCents(r.inc - r.exp), ids: r.ids });
  return out;
}

export interface Treasury {
  /** The balance it starts from: the latest stated on or before today. */
  anchor: BalanceLike | null;
  /** Cash now, carried forward from the anchor; null without an anchor. */
  cash: number | null;
  /** The dated movements after the anchor, up to today. */
  sinceAnchor: { net: number; ids: string[] };
  /** Dated transactions after today (scheduled): not in the cash. */
  future: number;
  /** How many transactions have no date yet. */
  undated: number;
  /** The complete months the burn is averaged over (oldest first), and its value. */
  burn: { months: MonthFlow[]; averageNet: number } | null;
  /**
   * Months of cash left at that burn, and the month it runs out; "growing"
   * when the months net positive; null when it cannot be said.
   */
  runway: { months: number; endsIn: string } | "growing" | null;
}

/** How many complete months the burn looks back over, at most. */
export const BURN_WINDOW = 3;

export function treasury(txns: readonly TxnLike[], balances: readonly BalanceLike[], today: string): Treasury {
  const anchor =
    [...balances].filter((b) => b.asOf <= today).sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0))[0] ?? null;
  const dated = txns.filter((t) => !!t.occurredOn);
  const undated = txns.length - dated.length;
  const future = dated.filter((t) => t.occurredOn! > today).length;

  let cash: number | null = null;
  const since: { net: number; ids: string[] } = { net: 0, ids: [] };
  if (anchor) {
    // The stated balance already includes its own day's movements.
    let c = cents(anchor.amount);
    for (const t of dated) {
      if (t.occurredOn! > anchor.asOf && t.occurredOn! <= today) {
        const v = cents(t.amount) * (t.type === "Income" ? 1 : -1);
        c += v;
        since.net += v;
        since.ids.push(t.id);
      }
    }
    since.net = fromCents(since.net);
    cash = fromCents(c);
  }

  // The burn: complete months only (this month is not over), from the first
  // month the records cover, the last BURN_WINDOW of them.
  const flows = monthlyFlows(dated.filter((t) => t.occurredOn! <= today));
  const thisMonth = monthOf(today);
  const firstMonth = [...flows.keys()].sort()[0];
  let burn: Treasury["burn"] = null;
  if (firstMonth && firstMonth < thisMonth) {
    const months: MonthFlow[] = [];
    for (let k = 1; k <= BURN_WINDOW; k++) {
      const m = addMonths(thisMonth, -k);
      if (m < firstMonth) break;
      // A covered month with no movement is a month of zero, honestly.
      months.unshift(flows.get(m) ?? { month: m, income: 0, expense: 0, net: 0, ids: [] });
    }
    if (months.length > 0) {
      const avg = months.reduce((s, m) => s + cents(m.net), 0) / months.length;
      burn = { months, averageNet: fromCents(Math.round(avg)) };
    }
  }

  let runway: Treasury["runway"] = null;
  if (burn && cash !== null) {
    if (burn.averageNet >= 0) runway = "growing";
    else {
      const perMonth = -burn.averageNet;
      const months = Math.max(0, cash / perMonth);
      runway = { months: Math.floor(months * 10) / 10, endsIn: addMonths(thisMonth, Math.floor(months)) };
    }
  }

  return { anchor, cash, sinceAnchor: since, future, undated, burn, runway };
}
