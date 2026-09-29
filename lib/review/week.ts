/**
 * The Friday review's week: which days it covers, what the records hold for
 * them, and which earlier decisions are due for a second look.
 *
 * Days are the person's own calendar days (YYYY-MM-DD): the page passes
 * instants converted to its local day, so "this week" is theirs, not the
 * server's. Pure; tested.
 */

/** YYYY-MM-DD + n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the ISO week containing `day`. */
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const iso = (d.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(day, -iso);
}

/** Whether `day` falls in the week that starts on `weekStart`. */
export function inWeek(day: string | null | undefined, weekStart: string): boolean {
  return !!day && day >= weekStart && day < addDays(weekStart, 7);
}

export interface WeekInput {
  /** Each with the local day it was created / done / happened. */
  notes: { id: string; title: string; day: string }[];
  remindersDone: { title: string; day: string }[];
  transactions: { type: "Income" | "Expense"; amount: number; day: string | null }[];
  deals: { name: string; day: string }[];
  reviews: { weekStart: string; decisions: { id: string; text: string; why: string; revisitOn: string | null }[] }[];
}

export interface WeekFacts {
  notes: { id: string; title: string }[];
  remindersDone: string[];
  moneyIn: number;
  moneyOut: number;
  transactions: number;
  newDeals: string[];
  /** Earlier decisions whose day to revisit has come (up to this week's end), oldest first. */
  revisit: { text: string; why: string; revisitOn: string; decidedWeek: string }[];
}

export function weekFacts(input: WeekInput, weekStart: string): WeekFacts {
  const end = addDays(weekStart, 7);
  let moneyIn = 0;
  let moneyOut = 0;
  let transactions = 0;
  for (const t of input.transactions) {
    if (!inWeek(t.day, weekStart)) continue;
    transactions++;
    if (t.type === "Income") moneyIn += Math.round(t.amount * 100);
    else moneyOut += Math.round(t.amount * 100);
  }
  const revisit = input.reviews
    .filter((r) => r.weekStart < weekStart)
    .flatMap((r) => r.decisions.map((d) => ({ ...d, decidedWeek: r.weekStart })))
    .filter((d): d is typeof d & { revisitOn: string } => !!d.revisitOn && d.revisitOn < end)
    .sort((a, b) => (a.revisitOn < b.revisitOn ? -1 : 1))
    .map(({ text, why, revisitOn, decidedWeek }) => ({ text, why, revisitOn, decidedWeek }));
  return {
    notes: input.notes.filter((n) => inWeek(n.day, weekStart)).map(({ id, title }) => ({ id, title })),
    remindersDone: input.remindersDone.filter((r) => inWeek(r.day, weekStart)).map((r) => r.title),
    moneyIn: moneyIn / 100,
    moneyOut: moneyOut / 100,
    transactions,
    newDeals: input.deals.filter((d) => inWeek(d.day, weekStart)).map((d) => d.name),
    revisit,
  };
}

/** Friday, Saturday or Sunday: the moment to suggest the review. */
export function isReviewTime(day: string): boolean {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6 || dow === 0;
}
