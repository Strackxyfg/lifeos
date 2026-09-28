import { occurrenceAfter, type Repeat } from "./schedule";
import { addDays, daysInMonth, wallTime, weekday, zonedInstant, type Wall } from "./zoned";

/**
 * "Appeler Marc demain à 9h", "réunion tous les lundis à 10h30", "call Anna
 * tomorrow at 3pm", "dans 20 minutes sortir le linge": a reminder written the
 * way one says it, in French or English, read into a title, a moment and a
 * repeat.
 *
 * Deterministic rules, not a model: the same words always give the same
 * reminder, instantly, offline, and what was understood is shown as the
 * person types (the spans) — so a misreading is seen before it is saved,
 * never discovered at the wrong hour. What is not understood stays in the
 * title and the moment is left for the person to pick.
 */

export interface ParsedReminder {
  title: string;
  /** Null when the text says no moment. */
  dueAt: Date | null;
  repeat: Repeat;
  /** The parts of the text that were read as a moment or a repeat. */
  spans: [number, number][];
}

type Locale = "fr" | "en";

const DEFAULT_HOUR = 9;

const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Month names and their abbreviations, to a month number. */
const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7,
  aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_WORDS = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30,
};
const NUMBER_ALT = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|");

const PARTS_OF_DAY: Record<string, [number, number]> = {
  matin: [9, 0], midi: [12, 0], "apres-midi": [15, 0], "apres midi": [15, 0], aprem: [15, 0], soir: [19, 0], soiree: [19, 0],
  morning: [9, 0], noon: [12, 0], afternoon: [15, 0], evening: [19, 0], night: [21, 0],
};

/**
 * Lower case, accents removed, apostrophes straightened — one character for
 * one character, so a position in it is a position in the original.
 */
function normalise(text: string): string {
  let out = "";
  for (const ch of text) {
    let c = ch.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    if (c === "’" || c === "‘" || c === "`") c = "'";
    // Characters outside the BMP take two code units in the original.
    const width = ch.length;
    c = (c || ch).slice(0, 1);
    out += c + (width > 1 ? " ".repeat(width - 1) : "");
  }
  return out;
}

const word = (body: string) => new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, "g");

function numberOf(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? NaN;
}

export function parseReminder(text: string, now: Date, zone: string, locale: Locale): ParsedReminder {
  const norm = normalise(text);
  const used: boolean[] = new Array(norm.length).fill(false);
  const spans: [number, number][] = [];

  /** Each unused match of `re`; `fn` returns false to leave it unconsumed. */
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    for (const m of norm.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (used.slice(start, end).some(Boolean)) continue;
      if (fn(m as RegExpExecArray) === false) continue;
      for (let i = start; i < end; i++) used[i] = true;
      spans.push([start, end]);
    }
  };

  let repeat: Repeat = "none";
  let repeatWeekday: number | null = null;
  let monthDay: number | null = null;
  let dayOffset: number | null = null;
  let wantWeekday: number | null = null;
  let strictlyNext = false;
  let date: { y: number | null; mo: number; d: number } | null = null;
  let time: [number, number] | null = null;
  let part: [number, number] | null = null;
  let relativeMs: number | null = null;
  let monthOffset = 0;

  const nowW = wallTime(now, zone);

  /* ── Repeats ─────────────────────────────────────────────────────── */
  take(word(`(?:tous les|toutes les|chaque) (${WEEKDAYS_FR.join("|")})s?(?: (matin|midi|apres-midi|soir))?`), (m) => {
    repeat = "weekly";
    repeatWeekday = WEEKDAYS_FR.indexOf(m[1]);
    if (m[2]) part = PARTS_OF_DAY[m[2]];
  });
  // "every friday" and "on fridays" repeat; "on friday" is one day, read below.
  take(word(`(?:(?:every|each) (${WEEKDAYS_EN.join("|")})s?|on (${WEEKDAYS_EN.join("|")})s)(?: (morning|afternoon|evening|night))?`), (m) => {
    repeat = "weekly";
    repeatWeekday = WEEKDAYS_EN.indexOf(m[1] ?? m[2]);
    if (m[3]) part = PARTS_OF_DAY[m[3]];
  });
  take(word("tous les jours ouvres|les jours ouvres|en semaine|du lundi au vendredi|every weekday|on weekdays|weekdays"), () => {
    repeat = "weekdays";
  });
  take(word("tous les (matins|soirs)|chaque (matin|soir)|every (morning|evening|night)"), (m) => {
    repeat = "daily";
    const w = m[1] ?? m[2] ?? m[3];
    part = PARTS_OF_DAY[w.replace(/s$/, "")];
  });
  take(word("tous les jours|chaque jour|quotidiennement|every day|each day|daily"), () => {
    repeat = "daily";
  });
  take(word("toutes les semaines|chaque semaine|une fois par semaine|hebdomadairement|every week|each week|weekly"), () => {
    repeat = "weekly";
  });
  take(word("(?:le |tous les )(\\d{1,2})(?:er)? (?:de chaque mois|du mois)|on the (\\d{1,2})(?:st|nd|rd|th)? of (?:every|each) month"), (m) => {
    const d = Number(m[1] ?? m[2]);
    if (d < 1 || d > 31) return false;
    repeat = "monthly";
    monthDay = d;
  });
  take(word("tous les mois|chaque mois|une fois par mois|mensuellement|every month|each month|monthly"), () => {
    repeat = "monthly";
  });

  /* ── Relative: "dans 20 minutes", "in 2 hours" ───────────────────── */
  take(word(`(?:dans|in) (une demi(?:-| )heure|un quart d'heure|half an hour)`), (m) => {
    relativeMs = m[1].includes("quart") ? 15 * 60_000 : 30 * 60_000;
  });
  take(
    word(`(?:dans|in) (\\d+|${NUMBER_ALT}) ?(minutes?|mins?|heures?|hours?|hrs?|h|jours?|days?|semaines?|weeks?|mois|months?)`),
    (m) => {
      const n = numberOf(m[1]);
      if (!Number.isFinite(n) || n <= 0 || n > 1000) return false;
      const unit = m[2];
      if (/^min/.test(unit)) relativeMs = n * 60_000;
      else if (/^(h|heure|hour|hr)/.test(unit)) relativeMs = n * 3_600_000;
      else if (/^(jour|day)/.test(unit)) dayOffset = (dayOffset ?? 0) + n;
      else if (/^(semaine|week)/.test(unit)) dayOffset = (dayOffset ?? 0) + 7 * n;
      else monthOffset += n;
    }
  );

  /* ── Days ────────────────────────────────────────────────────────── */
  const partAlt = "matin|midi|apres-midi|apres midi|aprem|soir|morning|afternoon|evening|night";
  take(word(`(apres-demain|apres demain|day after tomorrow)(?: (?:au |en |in the )?(${partAlt}))?`), (m) => {
    dayOffset = 2;
    if (m[2]) part = PARTS_OF_DAY[m[2]];
  });
  take(word(`(demain|tomorrow)(?: (?:au |en |in the )?(${partAlt}))?`), (m) => {
    dayOffset = 1;
    if (m[2]) part = PARTS_OF_DAY[m[2]];
  });
  take(word("aujourd'hui|aujourd hui|today"), () => {
    dayOffset = 0;
  });
  take(word("ce (soir|matin|midi)|cet (apres-midi|aprem)|cette (nuit)|tonight|this (morning|afternoon|evening)"), (m) => {
    dayOffset = 0;
    const w = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "evening";
    part = w === "nuit" ? [21, 0] : PARTS_OF_DAY[w];
  });
  take(word("la semaine prochaine|semaine prochaine|next week"), () => {
    wantWeekday = 1;
    strictlyNext = true;
  });
  take(word("ce week-end|ce weekend|le week-end|this weekend|at the weekend|on the weekend"), () => {
    wantWeekday = 6;
    part = part ?? [10, 0];
  });
  take(
    word(`(?:(next|on) )?(${WEEKDAYS_EN.join("|")})(?: (${partAlt}))?|(${WEEKDAYS_FR.join("|")})( prochain)?(?: (${partAlt}))?`),
    (m) => {
      if (m[2]) {
        wantWeekday = WEEKDAYS_EN.indexOf(m[2]);
        strictlyNext = m[1] === "next";
        if (m[3]) part = PARTS_OF_DAY[m[3]];
      } else {
        wantWeekday = WEEKDAYS_FR.indexOf(m[4]);
        strictlyNext = !!m[5];
        if (m[6]) part = PARTS_OF_DAY[m[6]];
      }
    }
  );

  /* ── Dates ───────────────────────────────────────────────────────── */
  take(/(?<![0-9])(\d{4})-(\d{2})-(\d{2})(?![0-9])/g, (m) => {
    date = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  });
  take(word(`(?:le |on (?:the )?)?(\\d{1,2})(?:er|st|nd|rd|th)? (?:of )?(${MONTH_WORDS})\\.?(?: (\\d{4}))?`), (m) => {
    date = { y: m[3] ? Number(m[3]) : null, mo: MONTHS[m[2]], d: Number(m[1]) };
  });
  take(word(`(?:on )?(${MONTH_WORDS})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?`), (m) => {
    date = { y: m[3] ? Number(m[3]) : null, mo: MONTHS[m[1]], d: Number(m[2]) };
  });
  take(/(?<![0-9/])(?:le |on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![0-9/])/g, (m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Day first in French, month first in English.
    const [d, mo] = locale === "fr" ? [a, b] : [b, a];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    date = { y, mo, d };
  });

  /* ── Times ───────────────────────────────────────────────────────── */
  take(word("(?:a |at )?(midi|noon)"), () => {
    time = [12, 0];
  });
  take(word("(?:a |at )?(minuit|midnight)"), () => {
    time = [23, 59];
  });
  take(/(?<![a-z0-9:])(?:(?:a|at|vers|around|pour|by) )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)(?![a-z])/g, (m) => {
    let h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || mi > 59) return false;
    const pm = m[3].startsWith("p");
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    time = [h, mi];
  });
  take(/(?<![a-z0-9:])(?:(?:a|vers|pour) )?(\d{1,2}) ?h ?(\d{2})?(?![a-z0-9])/g, (m) => {
    const h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h > 23 || mi > 59) return false;
    time = [h, mi];
  });
  take(/(?<![a-z0-9:/])(?:(?:a|at|vers|around|pour|by) )?(\d{1,2}):(\d{2})(?![0-9])/g, (m) => {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return false;
    time = [h, mi];
  });
  take(/(?<![a-z0-9:])at (\d{1,2})(?![0-9:a-z])/g, (m) => {
    let h = Number(m[1]);
    if (h > 23) return false;
    // "at 5" means five in the afternoon: nobody sets a reminder for 5am by saying so.
    if (h >= 1 && h <= 6) h += 12;
    time = [h, 0];
  });

  /* ── The moment ──────────────────────────────────────────────────── */
  const at = (w: Wall) => zonedInstant(w, zone);
  const [h, mi] = time ?? part ?? [DEFAULT_HOUR, 0];
  const today: Wall = { y: nowW.y, mo: nowW.mo, d: nowW.d, h, mi };
  let dueAt: Date | null = null;

  const sayDay = date !== null || dayOffset !== null || wantWeekday !== null || monthOffset > 0;

  if (relativeMs !== null && !sayDay && !time) {
    dueAt = new Date(now.getTime() + relativeMs);
  } else if (date) {
    const dt = date as { y: number | null; mo: number; d: number };
    let y = dt.y ?? nowW.y;
    const clampDay = (yy: number) => Math.min(dt.d, daysInMonth(yy, dt.mo));
    let candidate = at({ y, mo: dt.mo, d: clampDay(y), h, mi });
    // A date without a year that has already gone by is next year's.
    if (dt.y === null && candidate.getTime() < now.getTime() - 86_400_000) {
      y += 1;
      candidate = at({ y, mo: dt.mo, d: clampDay(y), h, mi });
    }
    dueAt = candidate;
  } else if (dayOffset !== null || monthOffset > 0) {
    let w = addDays(today, dayOffset ?? 0);
    if (monthOffset > 0) {
      const months = w.y * 12 + (w.mo - 1) + monthOffset;
      const y = Math.floor(months / 12);
      const mo = (months % 12) + 1;
      w = { ...w, y, mo, d: Math.min(w.d, daysInMonth(y, mo)) };
    }
    dueAt = at(w);
  } else if (wantWeekday !== null) {
    let ahead = (wantWeekday - weekday(today) + 7) % 7;
    // "lundi" on a Monday is next Monday — unless an hour still to come today is given.
    if (ahead === 0 && (strictlyNext || !time || at(today) <= now)) ahead = 7;
    dueAt = at(addDays(today, ahead));
  } else if (repeat !== "none") {
    let w = today;
    if (repeatWeekday !== null) w = addDays(today, (repeatWeekday - weekday(today) + 7) % 7);
    if (monthDay !== null) w = { ...w, d: Math.min(monthDay, daysInMonth(w.y, w.mo)) };
    dueAt = at(w);
  } else if (time) {
    // An hour alone is the next time the clock shows it.
    dueAt = at(today);
    if (dueAt <= now) dueAt = at(addDays(today, 1));
  }

  // A series starts at its first occurrence still to come.
  if (dueAt && repeat !== "none" && dueAt <= now) {
    let anchor = dueAt;
    if (repeat === "weekly" && repeatWeekday !== null) {
      const w = wallTime(anchor, zone);
      anchor = at(addDays({ y: w.y, mo: w.mo, d: w.d, h, mi }, (repeatWeekday - weekday(w) + 7) % 7));
    }
    dueAt = anchor > now ? anchor : occurrenceAfter(anchor, repeat, now, zone);
  }

  return { title: tidyTitle(text, used), dueAt, repeat, spans: spans.sort((a, b) => a[0] - b[0]) };
}

/** The text that was not read as a moment, tidied into a title. */
function tidyTitle(text: string, used: boolean[]): string {
  let kept = "";
  for (let i = 0; i < text.length; i++) kept += used[i] ? " " : text[i];
  let t = kept.replace(/\s+/g, " ").trim();
  // Ways of asking that are not what to be reminded of.
  t = t.replace(/^(rappelle[- ]moi|rappelle|rappel|penser|pense|n['’]oublie pas|ne pas oublier|remind me|remember|don['’]t forget)\s*(:|,)?\s*(de |d['’]|qu['’]|que |to |that |about |a |à )?/i, "");
  // Connectors left hanging at either end once the moment is taken out.
  const dangling = /^(?:,|-|–|:|et|and|le|la|les|de|du|d['’]|pour|à|a|at|on|by|the|to|vers)\s+|\s+(?:,|-|–|:|et|and|le|la|les|de|du|pour|à|a|at|on|by|the|to|vers)$/i;
  for (let i = 0; i < 4; i++) t = t.replace(dangling, "").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1").replace(/[,;:-]+$/, "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
