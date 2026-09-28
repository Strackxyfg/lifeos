import { bucketOf } from "./schedule";

/**
 * A reminder's moment in words: "in 20 min", "today, 14:30", "tomorrow,
 * 9:00", "Mon 5 Oct, 9:00" — relative when it is close, a date when it is
 * not. Always on the clock of the reminder's own zone.
 */
export function formatWhen(dueAt: Date, now: Date, locale: "fr" | "en", zone: string): string {
  const tag = locale === "fr" ? "fr-FR" : "en-GB";
  const minutes = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  // Intl's "this minute" reads oddly for a reminder going off: say "now".
  if (minutes === 0) return locale === "fr" ? "Maintenant" : "Now";
  if (Math.abs(minutes) < 60) {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" });
    return rtf.format(minutes, "minute");
  }
  const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(dueAt);
  const bucket = bucketOf(dueAt, now, zone);
  const rtfDay = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  if (bucket === "today" || (bucket === "overdue" && sameDay(dueAt, now, zone))) return `${capital(rtfDay.format(0, "day"))}, ${time}`;
  if (bucket === "tomorrow") return `${capital(rtfDay.format(1, "day"))}, ${time}`;
  const day = new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(dueAt);
  return `${capital(day)}, ${time}`;
}

function sameDay(a: Date, b: Date, zone: string): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(a) === f.format(b);
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The browser's zone, or UTC when it will not say. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A `datetime-local` value (wall clock, no zone) for an instant, in the browser's zone. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
