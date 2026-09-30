/**
 * Rhythms: what the person's check-ins (mood and energy, 1 to 5) say, with
 * the caution numbers deserve.
 *
 * Nothing here is claimed from too little. A pattern ("your energy is higher
 * on Tuesdays", "…in the morning") is reported only when each group compared
 * holds at least `MIN_GROUP` check-ins, the gap between them is at least
 * `MIN_GAP` points on the 5-point scale, and the effect is large (Cohen's d
 * ≥ `MIN_EFFECT`). Every figure comes with how many check-ins it rests on,
 * and nothing is said about causes — a check-in records how someone was,
 * not why.
 *
 * Pure: days are strings (YYYY-MM-DD) in the person's own calendar, fixed
 * when they checked in; `today` is passed in.
 */

export interface CheckinLike {
  /** The person's local day, YYYY-MM-DD. */
  day: string;
  /** Their local hour, 0–23. */
  hour: number;
  mood: number | null;
  energy: number | null;
}

export type Metric = "mood" | "energy";
export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

/** Check-ins each group needs before anything is said about it. */
export const MIN_GROUP = 3;
/** The smallest gap worth mentioning, in points on the 5-point scale. */
export const MIN_GAP = 0.7;
/** Cohen's d from which a difference is called large. */
export const MIN_EFFECT = 0.8;
/** Check-ins each week needs before two weeks are compared. */
export const MIN_WEEK = 4;

export interface Mean {
  mean: number;
  n: number;
}

export interface Pattern {
  metric: Metric;
  best: { key: string; mean: number; n: number };
  worst: { key: string; mean: number; n: number };
  /** Cohen's d, pooled. */
  effect: number;
}

export interface RhythmSummary {
  /** Check-ins in all. */
  count: number;
  /** Consecutive days with a check-in, ending today (or yesterday, if today has none yet). */
  streak: number;
  /** Checked in today. */
  today: boolean;
  /** The last 7 days and the 7 before, per metric. */
  week: Record<Metric, { recent: Mean | null; previous: Mean | null; trend: "up" | "down" | "steady" | null }>;
  /** Weekday patterns (keys "0"–"6", Sunday first), when the data holds one. */
  weekdays: Pattern[];
  /** Part-of-day patterns, when the data holds one. */
  parts: Pattern[];
  /** The last 30 days, one point per day that has one (daily means). */
  series: { day: string; mood: number | null; energy: number | null }[];
}

const DAY_MS = 86_400_000;

/** Days since the epoch for a YYYY-MM-DD string, or NaN. */
export function dayNumber(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return NaN;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  // 2026-02-30 is not a day.
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return NaN;
  return Math.floor(t / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(dayNumber(day) * DAY_MS).getUTCDay();
}

export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

function stats(values: number[]): { mean: number; sd: number; n: number } {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, sd: Math.sqrt(variance), n };
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * The largest difference between two groups that the data can hold, or null.
 * Groups with fewer than `MIN_GROUP` values are left out.
 */
export function strongestPattern(metric: Metric, groups: Map<string, number[]>): Pattern | null {
  const eligible = [...groups.entries()].filter(([, v]) => v.length >= MIN_GROUP).map(([key, v]) => ({ key, ...stats(v) }));
  if (eligible.length < 2) return null;
  eligible.sort((a, b) => b.mean - a.mean || a.key.localeCompare(b.key));
  const best = eligible[0];
  const worst = eligible[eligible.length - 1];
  const gap = best.mean - worst.mean;
  if (gap < MIN_GAP) return null;
  const pooled = Math.sqrt(((best.n - 1) * best.sd ** 2 + (worst.n - 1) * worst.sd ** 2) / (best.n + worst.n - 2));
  // All values equal within each group: the difference is as clear as it gets.
  const effect = pooled > 0 ? gap / pooled : Number.POSITIVE_INFINITY;
  if (effect < MIN_EFFECT) return null;
  return {
    metric,
    best: { key: best.key, mean: round(best.mean), n: best.n },
    worst: { key: worst.key, mean: round(worst.mean), n: worst.n },
    effect: Number.isFinite(effect) ? Math.round(effect * 100) / 100 : 99,
  };
}

function mean(values: number[]): Mean | null {
  if (values.length === 0) return null;
  return { mean: round(values.reduce((s, v) => s + v, 0) / values.length), n: values.length };
}

export function summarize(checkins: CheckinLike[], today: string): RhythmSummary {
  const t = dayNumber(today);
  const valid = checkins.filter((c) => Number.isFinite(dayNumber(c.day)) && dayNumber(c.day) <= t);
  const metrics: Metric[] = ["mood", "energy"];

  // Streak: consecutive days back from today, or from yesterday when today is still empty.
  const days = new Set(valid.map((c) => dayNumber(c.day)));
  const checkedToday = days.has(t);
  let streak = 0;
  for (let d = checkedToday ? t : t - 1; days.has(d); d--) streak++;

  const week = Object.fromEntries(
    metrics.map((metric) => {
      const recent = valid.filter((c) => t - dayNumber(c.day) < 7).map((c) => c[metric]).filter((v): v is number => v !== null);
      const previous = valid
        .filter((c) => t - dayNumber(c.day) >= 7 && t - dayNumber(c.day) < 14)
        .map((c) => c[metric])
        .filter((v): v is number => v !== null);
      const r = mean(recent);
      const p = mean(previous);
      let trend: "up" | "down" | "steady" | null = null;
      if (r && p && r.n >= MIN_WEEK && p.n >= MIN_WEEK) {
        const delta = r.mean - p.mean;
        trend = delta >= 0.5 ? "up" : delta <= -0.5 ? "down" : "steady";
      }
      return [metric, { recent: r, previous: p, trend }];
    })
  ) as RhythmSummary["week"];

  const grouped = (metric: Metric, keyOf: (c: CheckinLike) => string) => {
    const groups = new Map<string, number[]>();
    for (const c of valid) {
      const v = c[metric];
      if (v === null) continue;
      const k = keyOf(c);
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    return groups;
  };
  const weekdays = metrics
    .map((metric) => strongestPattern(metric, grouped(metric, (c) => String(weekdayOf(c.day)))))
    .filter((p): p is Pattern => p !== null);
  const parts = metrics
    .map((metric) => strongestPattern(metric, grouped(metric, (c) => partOfDay(c.hour))))
    .filter((p): p is Pattern => p !== null);

  // One point per day over the last 30: the day's means.
  const byDay = new Map<string, CheckinLike[]>();
  for (const c of valid) if (t - dayNumber(c.day) < 30) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  const series = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      const avg = (metric: Metric) => {
        const v = list.map((c) => c[metric]).filter((x): x is number => x !== null);
        return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length) : null;
      };
      return { day, mood: avg("mood"), energy: avg("energy") };
    });

  return { count: valid.length, streak, today: checkedToday, week, weekdays, parts, series };
}

/** The person's local day and hour at an instant, in their time zone. */
export function localDayHour(at: Date, zone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}
