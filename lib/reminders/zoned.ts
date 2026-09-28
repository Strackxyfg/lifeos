/**
 * Wall-clock time in a named time zone, without a date library.
 *
 * A reminder "every day at 9" means 9 on the person's clock — through the
 * change to winter time, when that is 07:00 UTC in summer and 08:00 in
 * winter. So repeats are computed on the wall clock of the reminder's zone
 * and only then turned into an instant, with the zone's offset at that
 * instant (read from Intl, which carries the IANA database).
 */

export interface Wall {
  y: number;
  /** 1–12. */
  mo: number;
  d: number;
  h: number;
  mi: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock time in `zone` at `instant`. */
export function wallTime(instant: Date, zone: string): Wall & { s: number } {
  const parts = formatter(zone).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** How far ahead of UTC `zone` is at `instant`, in milliseconds. */
export function offsetMs(instant: Date, zone: string): number {
  const w = wallTime(instant, zone);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which `zone`'s clock shows `w`. Out-of-range fields roll
 * over (day 32 is the 1st of the next month). A time that does not exist —
 * skipped when the clocks go forward — lands on the same wall time an hour
 * later, which is when the clock can next show it.
 */
export function zonedInstant(w: Wall, zone: string): Date {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, 0);
  // The wall time asked, normalised (day 32 → the 1st of the next month).
  const g = new Date(guess);
  const reads = (t: number) => {
    const r = wallTime(new Date(t), zone);
    return (
      r.y === g.getUTCFullYear() &&
      r.mo === g.getUTCMonth() + 1 &&
      r.d === g.getUTCDate() &&
      r.h === g.getUTCHours() &&
      r.mi === g.getUTCMinutes()
    );
  };
  // Around any change of offset, the zone's offset a day before and a day
  // after are the two it switches between: each gives a candidate.
  const before = offsetMs(new Date(guess - 86_400_000), zone);
  const after = offsetMs(new Date(guess + 86_400_000), zone);
  const candidates = [guess - before, guess - after].sort((a, b) => a - b);
  const valid = candidates.filter(reads);
  // Clocks going back show it twice: the first time. Clocks going forward
  // never show it: the time the gap pushes it to.
  return new Date(valid.length > 0 ? valid[0] : guess - before);
}

/** A calendar date moved by whole days, on the wall clock. */
export function addDays(w: Wall, days: number): Wall {
  const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + days));
  return { ...w, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday, for a wall date. */
export function weekday(w: Pick<Wall, "y" | "mo" | "d">): number {
  return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
}

/** The wall date, as a comparable day number. */
export function dayNumber(w: Pick<Wall, "y" | "mo" | "d">): number {
  return Math.floor(Date.UTC(w.y, w.mo - 1, w.d) / 86_400_000);
}
