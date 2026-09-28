import { describe, it, expect } from "vitest";
import { parseReminder } from "@/lib/reminders/parse";
import { bucketOf, completion, occurrenceAfter, snoozeUntil } from "@/lib/reminders/schedule";
import { isValidZone, wallTime, zonedInstant } from "@/lib/reminders/zoned";

const PARIS = "Europe/Paris";
const NY = "America/New_York";
/** Monday 28 September 2026, 14:00 in Paris (CEST, UTC+2) — 08:00 in New York. */
const NOW = new Date("2026-09-28T12:00:00Z");

const fr = (text: string) => parseReminder(text, NOW, PARIS, "fr");
const en = (text: string) => parseReminder(text, NOW, NY, "en");
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("reading a reminder written in French", () => {
  it.each([
    ["Appeler Marc demain à 9h", "Appeler Marc", "2026-09-29T07:00:00.000Z", "none"],
    ["rappelle-moi d'envoyer le devis vendredi", "Envoyer le devis", "2026-10-02T07:00:00.000Z", "none"],
    ["Réunion d'équipe tous les lundis à 10h30", "Réunion d'équipe", "2026-10-05T08:30:00.000Z", "weekly"],
    ["Payer le loyer le 5 de chaque mois", "Payer le loyer", "2026-10-05T07:00:00.000Z", "monthly"],
    ["dans 20 minutes sortir le linge", "Sortir le linge", "2026-09-28T12:20:00.000Z", "none"],
    ["ce soir appeler maman", "Appeler maman", "2026-09-28T17:00:00.000Z", "none"],
    ["Relancer Acme le 12/10 à 14h30", "Relancer Acme", "2026-10-12T12:30:00.000Z", "none"],
    ["Préparer le bilan le 3 octobre", "Préparer le bilan", "2026-10-03T07:00:00.000Z", "none"],
    ["Sport tous les jours à 7h", "Sport", "2026-09-29T05:00:00.000Z", "daily"],
    ["Point hebdo chaque semaine", "Point hebdo", "2026-10-05T07:00:00.000Z", "weekly"],
    ["Stand-up en semaine à 9h15", "Stand-up", "2026-09-29T07:15:00.000Z", "weekdays"],
    ["Appeler le médecin à 16h", "Appeler le médecin", "2026-09-28T14:00:00.000Z", "none"],
    ["Appeler le médecin à 11h", "Appeler le médecin", "2026-09-29T09:00:00.000Z", "none"],
    ["Déposer le dossier après-demain matin", "Déposer le dossier", "2026-09-30T07:00:00.000Z", "none"],
    ["Réviser dans 3 jours à 18h", "Réviser", "2026-10-01T16:00:00.000Z", "none"],
    ["Anniversaire de Léa le 1er janvier", "Anniversaire de Léa", "2027-01-01T08:00:00.000Z", "none"],
    ["Voir Paul lundi prochain", "Voir Paul", "2026-10-05T07:00:00.000Z", "none"],
    ["Voir Paul lundi", "Voir Paul", "2026-10-05T07:00:00.000Z", "none"],
    ["Café avec Inès dans une demi-heure", "Café avec Inès", "2026-09-28T12:30:00.000Z", "none"],
  ])("%s", (text, title, due, repeat) => {
    const r = fr(text);
    expect(r.title).toBe(title);
    expect(iso(r.dueAt)).toBe(due);
    expect(r.repeat).toBe(repeat);
  });

  it("leaves the moment to the person when the text gives none, and keeps every word", () => {
    const r = fr("Acheter du pain");
    expect(r).toMatchObject({ title: "Acheter du pain", dueAt: null, repeat: "none", spans: [] });
  });

  it("does not take ordinary words for times", () => {
    expect(fr("Former 10 hommes au support").dueAt).toBeNull();
    expect(fr("Former 10 hommes au support").title).toBe("Former 10 hommes au support");
  });

  it("marks what it understood, on the original text, accents included", () => {
    const text = "Déposer le dossier après-demain matin";
    const r = fr(text);
    expect(r.spans.map(([a, b]) => text.slice(a, b))).toEqual(["après-demain matin"]);
  });
});

describe("reading a reminder written in English", () => {
  it.each([
    ["Call Anna tomorrow at 3pm", "Call Anna", "2026-09-29T19:00:00.000Z", "none"],
    ["Standup every weekday at 9:15", "Standup", "2026-09-28T13:15:00.000Z", "weekdays"],
    ["Pay rent on Oct 1", "Pay rent", "2026-10-01T13:00:00.000Z", "none"],
    ["in 2 hours check the oven", "Check the oven", "2026-09-28T14:00:00.000Z", "none"],
    ["Review metrics every Friday", "Review metrics", "2026-10-02T13:00:00.000Z", "weekly"],
    ["Remind me to water the plants at 5", "Water the plants", "2026-09-28T21:00:00.000Z", "none"],
    ["Team lunch next Friday at noon", "Team lunch", "2026-10-02T16:00:00.000Z", "none"],
    ["Gym on mondays at 7am", "Gym", "2026-10-05T11:00:00.000Z", "weekly"],
    ["Dentist 10/15 at 9am", "Dentist", "2026-10-15T13:00:00.000Z", "none"],
    ["Dinner tonight", "Dinner", "2026-09-28T23:00:00.000Z", "none"],
  ])("%s", (text, title, due, repeat) => {
    const r = en(text);
    expect(r.title).toBe(title);
    expect(iso(r.dueAt)).toBe(due);
    expect(r.repeat).toBe(repeat);
  });

  it("reads numeric dates day-first in French and month-first in English", () => {
    expect(iso(parseReminder("Dossier 03/04/2027", NOW, PARIS, "fr").dueAt)).toBe("2027-04-03T07:00:00.000Z");
    expect(iso(parseReminder("Dossier 03/04/2027", NOW, PARIS, "en").dueAt)).toBe("2027-03-04T08:00:00.000Z");
  });
});

describe("the wall clock of a time zone", () => {
  it("round-trips a wall time through an instant", () => {
    const t = zonedInstant({ y: 2026, mo: 9, d: 28, h: 14, mi: 0 }, PARIS);
    expect(t.toISOString()).toBe("2026-09-28T12:00:00.000Z");
    expect(wallTime(t, PARIS)).toMatchObject({ y: 2026, mo: 9, d: 28, h: 14, mi: 0 });
  });

  it("puts a time the clock skips an hour later, and an ambiguous one at its first showing", () => {
    // 28 March 2027: Paris goes from 02:00 straight to 03:00.
    expect(zonedInstant({ y: 2027, mo: 3, d: 28, h: 2, mi: 30 }, PARIS).toISOString()).toBe("2027-03-28T01:30:00.000Z");
    // 25 October 2026: 02:30 happens twice; the first is 00:30 UTC.
    expect(zonedInstant({ y: 2026, mo: 10, d: 25, h: 2, mi: 30 }, PARIS).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("knows a real zone from a made-up one", () => {
    expect(isValidZone("Europe/Paris")).toBe(true);
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone("")).toBe(false);
  });
});

describe("repeats", () => {
  it("keeps 9 o'clock through the change to winter time", () => {
    const anchor = new Date("2026-10-24T07:00:00Z"); // Saturday 09:00 CEST
    const next = occurrenceAfter(anchor, "daily", new Date("2026-10-25T12:00:00Z"), PARIS);
    expect(next?.toISOString()).toBe("2026-10-26T08:00:00.000Z"); // Monday 09:00 CET
  });

  it("keeps the 31st through short months, without drifting", () => {
    const anchor = new Date("2027-01-31T08:00:00Z"); // 09:00 CET
    const feb = occurrenceAfter(anchor, "monthly", new Date("2027-02-01T00:00:00Z"), PARIS);
    expect(feb?.toISOString()).toBe("2027-02-28T08:00:00.000Z");
    const mar = occurrenceAfter(anchor, "monthly", feb!, PARIS);
    expect(mar?.toISOString()).toBe("2027-03-31T07:00:00.000Z"); // 09:00 CEST
  });

  it("skips the weekend on working days", () => {
    const friday = new Date("2026-10-02T07:00:00Z");
    expect(occurrenceAfter(friday, "weekdays", new Date("2026-10-02T08:00:00Z"), PARIS)?.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });

  it("comes back once after days away, not once per missed day", () => {
    const r = { dueAt: "2026-09-20T07:00:00.000Z", anchorAt: "2026-09-01T07:00:00.000Z", repeat: "daily" as const, zone: PARIS, done: false };
    const c = completion(r, NOW);
    expect(c).toMatchObject({ dueAt: "2026-09-29T07:00:00.000Z", notifiedAt: null });
    expect("done" in c).toBe(false);
  });

  it("finishes a one-off", () => {
    const r = { dueAt: "2026-09-28T07:00:00.000Z", anchorAt: "2026-09-28T07:00:00.000Z", repeat: "none" as const, zone: PARIS, done: false };
    expect(completion(r, NOW)).toEqual({ done: true, doneAt: NOW.toISOString() });
  });

  it("answers quickly for a series anchored long ago", () => {
    const t0 = performance.now();
    const next = occurrenceAfter(new Date("2019-01-01T08:00:00Z"), "daily", NOW, PARIS);
    expect(next?.toISOString()).toBe("2026-09-29T07:00:00.000Z");
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("snoozing and sorting", () => {
  it("snoozes to tomorrow at 9 and to next Monday at 9, on the person's clock", () => {
    expect(snoozeUntil("10m", NOW, PARIS).toISOString()).toBe("2026-09-28T12:10:00.000Z");
    expect(snoozeUntil("tomorrow", NOW, PARIS).toISOString()).toBe("2026-09-29T07:00:00.000Z");
    // NOW is a Monday: next Monday is a week away.
    expect(snoozeUntil("nextWeek", NOW, PARIS).toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });

  it("files reminders by day on the person's calendar", () => {
    expect(bucketOf(new Date("2026-09-28T11:00:00Z"), NOW, PARIS)).toBe("overdue");
    expect(bucketOf(new Date("2026-09-28T21:30:00Z"), NOW, PARIS)).toBe("today"); // 23:30 in Paris
    expect(bucketOf(new Date("2026-09-28T22:30:00Z"), NOW, PARIS)).toBe("tomorrow"); // 00:30 the next day
    expect(bucketOf(new Date("2026-10-02T07:00:00Z"), NOW, PARIS)).toBe("week");
    expect(bucketOf(new Date("2026-10-20T07:00:00Z"), NOW, PARIS)).toBe("later");
  });
});

describe("saying when", () => {
  it("is relative when close, a day word or a date otherwise, on the reminder's clock", async () => {
    const { formatWhen } = await import("@/lib/reminders/format");
    expect(formatWhen(NOW, NOW, "fr", PARIS)).toBe("Maintenant");
    expect(formatWhen(new Date(NOW.getTime() + 20 * 60_000), NOW, "en", PARIS)).toMatch(/20 min/);
    expect(formatWhen(new Date("2026-09-29T07:00:00Z"), NOW, "fr", PARIS)).toBe("Demain, 09:00");
    expect(formatWhen(new Date("2026-09-29T07:00:00Z"), NOW, "en", PARIS)).toBe("Tomorrow, 09:00");
    expect(formatWhen(new Date("2026-10-05T08:30:00Z"), NOW, "fr", PARIS)).toMatch(/^Lun\. 5 oct\., 10:30$/);
  });
});
