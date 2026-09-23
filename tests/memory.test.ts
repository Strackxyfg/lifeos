import { describe, it, expect } from "vitest";
import {
  DAILY_REVIEWS, MAX_INTERVAL, addDays, daysBetween, dueDay, reviewQueue, schedule, type Reviewable, type ReviewAnswer,
} from "@/lib/brain/review";
import type { BrainCategoryId } from "@/lib/data/brain";
import { sanitizeOptions } from "@/lib/brain/decide";
import { openTensions, toBrainLink } from "@/lib/brain/graph";

const TODAY = "2026-09-23";
const NOW = "2026-09-23T08:00:00.000Z";
const note = (id: string, createdDay: string, opts: Partial<Reviewable> = {}, category: BrainCategoryId = "ideas"): Reviewable => ({
  id, category, title: `Note ${id}`, detail: null, done: false, createdAt: `${createdDay}T10:00:00.000Z`, ...opts,
});

describe("days", () => {
  it("adds and counts calendar days in UTC, across months and years", () => {
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-09-20", TODAY)).toBe(3);
    expect(daysBetween(TODAY, "2026-09-20")).toBe(-3);
  });
});

describe("the review queue", () => {
  it("brings a note back three days after it was written, not before", () => {
    expect(dueDay(note("a", "2026-09-20"))).toBe(TODAY);
    const q = reviewQueue({ notes: [note("a", "2026-09-20"), note("b", "2026-09-21")], today: TODAY });
    expect(q.items.map((i) => i.id)).toEqual(["a"]);
    expect(q.items[0]).toMatchObject({ overdue: 0, first: true });
  });

  it("reviews only what is worth remembering, and nothing done", () => {
    const notes = [
      note("idea", "2026-01-01"),
      note("step", "2026-01-01", {}, "next"),
      note("goal", "2026-01-01", {}, "goals"),
      note("old", "2026-01-01", { done: true }),
      note("blank", "2026-01-01", { title: "  " }),
    ];
    expect(reviewQueue({ notes, today: TODAY }).items.map((i) => i.id)).toEqual(["idea"]);
  });

  it("puts scheduled reviews before the never-reviewed backlog, longest overdue first", () => {
    const notes = [
      note("backlog-old", "2025-01-01"),
      note("backlog-new", "2026-09-01"),
      note("promised", "2026-06-01", { reviewDue: "2026-09-22", reviewInterval: 7, reviewedAt: "2026-09-15T08:00:00Z" }),
      note("promised-today", "2026-06-01", { reviewDue: TODAY, reviewInterval: 18, reviewedAt: "2026-09-05T08:00:00Z" }),
      note("later", "2026-06-01", { reviewDue: "2026-10-30", reviewInterval: 45, reviewedAt: "2026-09-15T08:00:00Z" }),
    ];
    const q = reviewQueue({ notes, today: TODAY });
    expect(q.items.map((i) => i.id)).toEqual(["promised", "promised-today", "backlog-old", "backlog-new"]);
    expect(q.due).toBe(4);
  });

  it("caps the day to a short review, and counts the rest", () => {
    const notes = Array.from({ length: 40 }, (_, i) => note(`n${String(i).padStart(2, "0")}`, "2026-01-01"));
    const q = reviewQueue({ notes, today: TODAY });
    expect(q.items).toHaveLength(DAILY_REVIEWS);
    expect(q.due).toBe(40);
  });

  it("does not depend on the order notes arrive in", () => {
    const notes = [note("b", "2026-01-01"), note("a", "2026-01-01"), note("c", "2026-02-01")];
    const forward = reviewQueue({ notes, today: TODAY }).items;
    const backward = reviewQueue({ notes: [...notes].reverse(), today: TODAY }).items;
    expect(backward).toEqual(forward);
    expect(forward.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("scheduling an answer", () => {
  const run = (answers: ReviewAnswer[]) => {
    let n = note("x", "2026-09-20");
    let today = TODAY;
    const intervals: (number | null)[] = [];
    for (const a of answers) {
      const s = schedule(n, a, today, NOW);
      intervals.push(s.reviewInterval);
      n = { ...n, ...s };
      if (s.reviewDue) today = s.reviewDue;
    }
    return { intervals, n };
  };

  it("spaces reviews further apart each time the note still holds, up to six months", () => {
    const { intervals } = run(["keep", "keep", "keep", "keep", "keep", "keep", "keep"]);
    expect(intervals).toEqual([7, 18, 45, 113, MAX_INTERVAL, MAX_INTERVAL, MAX_INTERVAL]);
  });

  it("brings a note that needs rework back in two days, then grows again", () => {
    const { intervals } = run(["keep", "keep", "rework", "keep", "keep"]);
    expect(intervals).toEqual([7, 18, 2, 5, 13]);
  });

  it("archives a note that no longer holds: done, and never due again", () => {
    const s = schedule(note("x", "2026-01-01"), "archive", TODAY, NOW);
    expect(s).toEqual({ reviewDue: null, reviewInterval: null, reviewedAt: NOW, done: true });
    expect(reviewQueue({ notes: [{ ...note("x", "2026-01-01"), ...s }], today: TODAY }).due).toBe(0);
  });

  it("schedules from the day of the review, not from the day it was due", () => {
    const late = note("x", "2026-01-01", { reviewDue: "2026-09-01", reviewInterval: 7, reviewedAt: "2026-08-25T00:00:00Z" });
    expect(schedule(late, "keep", TODAY, NOW).reviewDue).toBe(addDays(TODAY, 18));
  });
});

describe("decided tensions", () => {
  const row = (id: string, kind: string, resolvedBy?: string) => ({ id, fromId: "a", toId: "b", kind, resolvedBy });

  it("keeps the decision on a tension, and only on a tension", () => {
    expect(toBrainLink(row("t", "tension", "d1")).resolvedBy).toBe("d1");
    expect(toBrainLink(row("s", "supports", "d1")).resolvedBy).toBeNull();
    expect(toBrainLink(row("t", "tension")).resolvedBy).toBeNull();
    expect(toBrainLink({ ...row("t", "tension"), resolvedBy: 42 }).resolvedBy).toBeNull();
  });

  it("lists only the tensions still to decide", () => {
    const links = [row("open", "tension"), row("done", "tension", "d1"), row("rel", "related")].map(toBrainLink);
    expect(openTensions(links).map((l) => l.id)).toEqual(["open"]);
  });
});

describe("decision options from the model", () => {
  it("keeps up to three distinct options", () => {
    const opts = sanitizeOptions({
      options: [
        { title: "Je reporte le Japon à l'an prochain", why: "L'apport passe d'abord.", favours: "b" },
        { title: "Je garde un voyage court", why: "Les deux restent possibles." },
        { title: "je reporte le japon à l'an prochain", why: "doublon" },
        { title: "ok" },
        { title: "Vérifier d'abord le budget" },
        { title: "Une quatrième option" },
      ],
    });
    expect(opts).toEqual([
      { title: "Je reporte le Japon à l'an prochain", why: "L'apport passe d'abord." },
      { title: "Je garde un voyage court", why: "Les deux restent possibles." },
      { title: "Vérifier d'abord le budget", why: "" },
    ]);
  });

  it("never throws on what a model might return", () => {
    for (const junk of [null, "text", 3, {}, { options: "x" }, { options: [null, 5, { title: 7 }] }]) {
      expect(sanitizeOptions(junk)).toEqual([]);
    }
    expect(sanitizeOptions([{ title: "Une option en tableau nu" }])).toHaveLength(1);
  });
});
