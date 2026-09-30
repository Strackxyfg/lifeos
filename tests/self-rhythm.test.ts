import { describe, expect, it } from "vitest";
import { MIN_GROUP, dayNumber, localDayHour, partOfDay, strongestPattern, summarize, weekdayOf, type CheckinLike } from "@/lib/self/rhythm";

const c = (day: string, hour: number, energy: number | null, mood: number | null = null): CheckinLike => ({ day, hour, energy, mood });

/** "2026-09-" + day, zero-padded. */
const sep = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

describe("days", () => {
  it("reads calendar days, and refuses days that do not exist", () => {
    expect(dayNumber("2026-09-30") - dayNumber("2026-09-29")).toBe(1);
    expect(dayNumber("2026-03-01") - dayNumber("2026-02-28")).toBe(1);
    expect(Number.isNaN(dayNumber("2026-02-30"))).toBe(true);
    expect(Number.isNaN(dayNumber("30/09/2026"))).toBe(true);
  });

  it("knows the weekday (30 September 2026 is a Wednesday)", () => {
    expect(weekdayOf("2026-09-30")).toBe(3);
    expect(weekdayOf("2026-09-27")).toBe(0);
  });

  it("sorts hours into parts of the day", () => {
    expect([4, 5, 11, 12, 17, 18, 22, 23].map(partOfDay)).toEqual(["night", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "night"]);
  });

  it("takes the person's own day and hour in their time zone", () => {
    const at = new Date("2026-09-30T23:30:00Z");
    expect(localDayHour(at, "Europe/Paris")).toEqual({ day: "2026-10-01", hour: 1 });
    expect(localDayHour(at, "America/New_York")).toEqual({ day: "2026-09-30", hour: 19 });
  });
});

describe("patterns, claimed only when the data holds them", () => {
  it("says nothing with fewer than three check-ins in a group", () => {
    const groups = new Map([
      ["morning", [5, 5]],
      ["evening", [1, 1, 1]],
    ]);
    expect(MIN_GROUP).toBe(3);
    expect(strongestPattern("energy", groups)).toBeNull();
  });

  it("says nothing of a small gap, however consistent", () => {
    const groups = new Map([
      ["morning", [3.5, 3.5, 3.5, 3.5]],
      ["evening", [3, 3, 3, 3]],
    ]);
    expect(strongestPattern("energy", groups)).toBeNull();
  });

  it("says nothing of a gap lost in the noise", () => {
    const groups = new Map([
      ["morning", [5, 1, 5, 1, 5]],
      ["evening", [4, 1, 4, 1, 3]],
    ]);
    expect(strongestPattern("energy", groups)).toBeNull();
  });

  it("names a large, clear difference, with its means, its counts and its effect", () => {
    const groups = new Map([
      ["morning", [4, 5, 4, 5]],
      ["afternoon", [3, 3, 4]],
      ["evening", [2, 1, 2, 2]],
    ]);
    const p = strongestPattern("energy", groups);
    expect(p).not.toBeNull();
    expect(p!.best).toEqual({ key: "morning", mean: 4.5, n: 4 });
    expect(p!.worst).toEqual({ key: "evening", mean: 1.8, n: 4 });
    expect(p!.effect).toBeGreaterThan(0.8);
  });
});

describe("the summary", () => {
  it("counts a streak back from today — or from yesterday while today is still empty", () => {
    const list = [c(sep(28), 9, 3), c(sep(29), 9, 3), c(sep(30), 9, 3), c(sep(25), 9, 3)];
    expect(summarize(list, sep(30))).toMatchObject({ streak: 3, today: true });
    expect(summarize(list.slice(0, 2), sep(30))).toMatchObject({ streak: 2, today: false });
    expect(summarize([c(sep(27), 9, 3)], sep(30)).streak).toBe(0);
  });

  it("compares two weeks only when each has enough check-ins, and names the trend", () => {
    // 7 to 13 days before the 30th: the 17th to the 23rd.
    const previous = [17, 18, 19, 20].map((d) => c(sep(d), 9, 2));
    const recent = [24, 25, 26, 27, 28].map((d) => c(sep(d), 9, 4));
    const s = summarize([...previous, ...recent], sep(30));
    expect(s.week.energy.recent).toEqual({ mean: 4, n: 5 });
    expect(s.week.energy.previous).toEqual({ mean: 2, n: 4 });
    expect(s.week.energy.trend).toBe("up");
    expect(summarize([...previous.slice(0, 3), ...recent], sep(30)).week.energy.trend).toBeNull();
    // Mood was never given: nothing said about it.
    expect(s.week.mood.recent).toBeNull();
  });

  it("finds a morning person in their own check-ins", () => {
    const list = [
      ...[1, 2, 3, 4, 5].map((d) => c(sep(d), 8, 4 + (d % 2))),
      ...[1, 2, 3, 4, 5].map((d) => c(sep(d), 20, 1 + (d % 2))),
    ];
    const s = summarize(list, sep(30));
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0].best.key).toBe("morning");
    expect(s.parts[0].worst.key).toBe("evening");
  });

  it("ignores impossible days and the future, and keeps one point per day over 30 days", () => {
    const list = [c("2026-02-30", 9, 3), c("2026-10-05", 9, 5), c(sep(29), 8, 2, 3), c(sep(29), 20, 4, 5), c("2026-08-01", 9, 1)];
    const s = summarize(list, sep(30));
    expect(s.count).toBe(3);
    expect(s.series).toEqual([{ day: sep(29), mood: 4, energy: 3 }]);
  });
});
