/**
 * Reading the day a transaction happened from what the person typed.
 *
 * Old entries carry free text ("Jul 26", "26/07", "3 sept."). A treasury
 * needs real dates, but a date is a fact about the person's money: this
 * module only *proposes*, and says how sure it is. A full date ("2026-07-26",
 * "26/07/2026", "July 26, 2026") is certain. A day and a month without a year
 * is a guess — the most recent such day not after the entry was recorded —
 * and is marked as such, for the person to confirm. Anything else is left
 * alone: no date is better than a wrong one.
 *
 * Pure; tested in both languages.
 */

export type Certainty = "exact" | "inferred-year";

export interface ProposedDate {
  /** YYYY-MM-DD */
  date: string;
  certainty: Certainty;
}

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, january: 1, janvier: 1,
  feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, avr: 4, april: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aou: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A real calendar day, or null (30 February is not one). */
export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d)(er|st|nd|rd|th)\b/g, "$1")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function monthOf(word: string): number | null {
  return MONTHS[word] ?? MONTHS[word.slice(0, 4)] ?? MONTHS[word.slice(0, 3)] ?? null;
}

/**
 * The latest occurrence of this day-and-month that is not after `ref`
 * (YYYY-MM-DD): a ledger records the past.
 */
function latestNotAfter(month: number, day: number, ref: string): string | null {
  const year = Number(ref.slice(0, 4));
  const thisYear = isoDate(year, month, day);
  if (thisYear && thisYear <= ref) return thisYear;
  // 29 February: walk back to the last leap year.
  for (let y = year - 1; y >= year - 8; y--) {
    const d = isoDate(y, month, day);
    if (d) return d;
  }
  return null;
}

/**
 * What date `text` means, recorded on `recordedOn` (YYYY-MM-DD), or null.
 * `dayFirst` reads 03/04 as 3 April (the French way) rather than March 4.
 */
export function proposeDate(text: string, recordedOn: string, dayFirst = true): ProposedDate | null {
  const t = normalise(text);
  if (!t) return null;

  // ISO: 2026-07-26 (or with slashes).
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) {
    const d = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { date: d, certainty: "exact" } : null;
  }

  // Numeric with a year: 26/07/2026, 07/26/2026, 26-07-26.
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += 2000;
    // Unambiguous when one side cannot be a month.
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : dayFirst ? [a, b] : [b, a];
    const d = isoDate(y, month, day);
    return d ? { date: d, certainty: "exact" } : null;
  }

  // Numeric without a year: 26/07.
  m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : dayFirst ? [a, b] : [b, a];
    if (!isoDate(2000, month, day)) return null;
    const d = latestNotAfter(month, day, recordedOn);
    return d ? { date: d, certainty: "inferred-year" } : null;
  }

  // Words: "jul 26", "26 july", "26 juillet 2026", "july 26 2026".
  const words = t.split(" ");
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  for (const w of words) {
    if (/^\d{4}$/.test(w) && year === null) year = Number(w);
    else if (/^\d{1,2}$/.test(w) && day === null) day = Number(w);
    else if (month === null && /^[a-z]+$/.test(w)) month = monthOf(w);
    else if (!/^(le|the|on|du|of)$/.test(w)) return null;
  }
  if (day === null || month === null) return null;
  if (year !== null) {
    const d = isoDate(year, month, day);
    return d ? { date: d, certainty: "exact" } : null;
  }
  if (!isoDate(2000, month, day)) return null;
  const d = latestNotAfter(month, day, recordedOn);
  return d ? { date: d, certainty: "inferred-year" } : null;
}
