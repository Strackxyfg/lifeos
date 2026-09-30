import { describe, expect, it } from "vitest";
import { adviseFor, isAdviceKey, isoWeek, namesTime, tomorrowMorning, type AdviceInput } from "@/lib/self/advice";
import { summarize } from "@/lib/self/rhythm";
import type { NoteLike } from "@/lib/brain/graph";
import type { TraitLike } from "@/lib/self/portrait";

// Wednesday 30 September 2026, 10:00 in Paris.
const now = new Date("2026-09-30T08:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const note = (id: string, category: NoteLike["category"], daysAgo: number, title = `Note ${id}`, done = false): NoteLike => ({ id, category, title, done, createdAt: ago(daysAgo) });

const input = (over: Partial<AdviceInput>): AdviceInput => ({
  notes: [],
  links: [],
  reminders: [],
  rhythm: null,
  traits: [],
  states: [],
  now,
  zone: "Europe/Paris",
  locale: "fr",
  limit: 20,
  ...over,
});
const kinds = (xs: { kind: string }[]) => xs.map((x) => x.kind);

describe("commitments in their own words", () => {
  it("offers a reminder at the moment a step names — read from the day it was written", () => {
    // Written on Monday 28th: "vendredi" is Friday 2 October, 9:00 in Paris.
    const out = adviseFor(input({ notes: [note("s", "next", 2, "Appeler Marc vendredi pour le devis")] }));
    const c = out.find((a) => a.kind === "commitment");
    expect(c).toBeDefined();
    expect(c!.facts.at).toBe("2026-10-02T07:00:00.000Z");
    expect(c!.actions[0]).toEqual({ type: "remind", noteId: "s", title: "Appeler Marc pour le devis", at: "2026-10-02T07:00:00.000Z" });
  });

  it("stays quiet when a reminder already exists for the step", () => {
    const out = adviseFor(input({ notes: [note("s", "next", 2, "Appeler Marc vendredi")], reminders: [{ noteId: "s", done: false, dueAt: ago(-2) }] }));
    expect(kinds(out)).not.toContain("commitment");
  });

  it("says when a named day has passed, within two weeks, and offers done or tomorrow", () => {
    // Written on 20 September (a Sunday): "lundi" was Monday 21st.
    const out = adviseFor(input({ notes: [note("s", "next", 10, "Envoyer le devis lundi")] }));
    const o = out.find((a) => a.kind === "overdue")!;
    // Monday 21st, 9:00 → Wednesday 30th, 10:00: nine days.
    expect(o.facts.days).toBe(9);
    expect(o.actions.map((a) => a.type)).toEqual(["done", "remind"]);
    expect((o.actions[1] as { at: string }).at).toBe(tomorrowMorning(now, "Europe/Paris", "fr").toISOString());
  });

  it("does not read a moment into a step that names none", () => {
    expect(kinds(adviseFor(input({ notes: [note("s", "next", 2, "Refaire le site")] })))).toEqual([]);
  });
});

describe("goals, tensions, steps and ideas", () => {
  it("flags a goal a week old with no open next step connected to it", () => {
    const notes = [note("g", "goals", 9, "Signer 10 clients"), note("h", "goals", 9), note("s", "next", 3), note("young", "goals", 2)];
    const links = [{ fromId: "s", toId: "h", kind: "advances" as const }];
    const out = adviseFor(input({ notes, links }));
    expect(out.filter((a) => a.kind === "goal-stuck").map((a) => a.noteIds[0])).toEqual(["g"]);
    expect(out.find((a) => a.kind === "goal-stuck")!.actions[0]).toEqual({ type: "steps", noteId: "g" });
  });

  it("raises a tension undecided for three days, not a resolved one", () => {
    const notes = [note("a", "ideas", 9), note("b", "ideas", 9)];
    const links = [{ id: "L", fromId: "a", toId: "b", kind: "tension" as const, createdAt: ago(4) }];
    expect(adviseFor(input({ notes, links })).find((a) => a.kind === "tension")!.actions).toEqual([{ type: "decide", linkId: "L" }]);
    expect(kinds(adviseFor(input({ notes, links: [{ ...links[0], createdAt: ago(1) }] })))).not.toContain("tension");
    expect(kinds(adviseFor(input({ notes, links: [{ ...links[0], resolvedBy: "d" }] })))).not.toContain("tension");
  });

  it("brings back the two oldest steps waiting three weeks, and no finished one", () => {
    const notes = [note("a", "next", 40), note("b", "next", 30), note("c", "next", 25), note("d", "next", 60, "x", true), note("e", "next", 5)];
    expect(adviseFor(input({ notes })).filter((a) => a.kind === "step-stale").map((a) => a.noteIds[0])).toEqual(["a", "b"]);
  });

  it("offers to connect one loose idea between two weeks and two months old", () => {
    const notes = [note("fresh", "ideas", 3), note("old", "ideas", 90), note("loose", "ideas", 20), note("linked", "ideas", 30), note("x", "thoughts", 30)];
    const links = [{ fromId: "linked", toId: "x" }];
    expect(adviseFor(input({ notes, links })).filter((a) => a.kind === "idea-loose").map((a) => a.noteIds[0])).toEqual(["loose"]);
  });

  it("names overload: many open steps, many serving no goal", () => {
    const notes = Array.from({ length: 13 }, (_, i) => note(`s${i}`, "next", 1));
    const o = adviseFor(input({ notes })).find((a) => a.kind === "overload")!;
    expect(o.facts).toEqual({ open: 13, unaligned: 13 });
    expect(o.key).toBe(`overload:${isoWeek(now)}`);
  });
});

describe("check-ins and the portrait", () => {
  it("notices low energy over the week — on at least three check-ins", () => {
    const low = summarize(
      ["2026-09-27", "2026-09-28", "2026-09-29"].map((day) => ({ day, hour: 9, mood: 3, energy: 2 })),
      "2026-09-30"
    );
    const e = adviseFor(input({ rhythm: low })).find((a) => a.kind === "energy-low")!;
    expect(e.facts).toMatchObject({ mean: 2, n: 3 });
    const few = summarize([{ day: "2026-09-29", hour: 9, mood: 1, energy: 1 }], "2026-09-30");
    expect(kinds(adviseFor(input({ rhythm: few })))).not.toContain("energy-low");
  });

  it("asks them to check the double's observations once there are three, keyed on the newest", () => {
    const t = (id: string, createdAt: string): TraitLike => ({ id, dimension: "values", statement: id, evidence: [], status: "proposed", origin: "ai", key: id, createdAt, updatedAt: createdAt });
    const out = adviseFor(input({ traits: [t("a", ago(3)), t("b", ago(1)), t("c", ago(2))] }));
    expect(out.find((a) => a.kind === "portrait")).toMatchObject({ key: "portrait:b", facts: { count: 3 } });
    expect(kinds(adviseFor(input({ traits: [t("a", ago(3)), t("b", ago(1))] })))).not.toContain("portrait");
  });
});

describe("what the person did with it", () => {
  const notes = [note("g", "goals", 9)];
  it("keeps a dismissed piece of advice away for good, and a snoozed one until its date", () => {
    expect(adviseFor(input({ notes, states: [{ adviceKey: "goal-stuck:g", status: "dismissed", until: null }] }))).toEqual([]);
    expect(adviseFor(input({ notes, states: [{ adviceKey: "goal-stuck:g", status: "snoozed", until: ago(-1) }] }))).toEqual([]);
    expect(kinds(adviseFor(input({ notes, states: [{ adviceKey: "goal-stuck:g", status: "snoozed", until: ago(1) }] })))).toEqual(["goal-stuck"]);
  });

  it("orders by what is most pressing, and is the same every time", () => {
    const all = [note("g", "goals", 9), note("s", "next", 2, "Appeler Marc vendredi"), note("i", "ideas", 20), note("t", "next", 30)];
    const a = adviseFor(input({ notes: all }));
    expect(kinds(a)).toEqual(["commitment", "goal-stuck", "step-stale", "idea-loose"]);
    expect(adviseFor(input({ notes: [...all].reverse() }))).toEqual(a);
  });

  it("shapes keys the page may send back", () => {
    expect(isAdviceKey("goal-stuck:3f2a9c1e-0000-4000-8000-000000000001")).toBe(true);
    expect(isAdviceKey("overload:2026-W40")).toBe(true);
    expect(isAdviceKey("nope:x")).toBe(false);
    expect(isAdviceKey("goal-stuck:<x>")).toBe(false);
  });
});

describe("what a step says of its moment", () => {
  it("tells a named time from a day alone, so advice never claims a time nobody said", () => {
    for (const s of ["Appeler Marc à 14h", "Réunion 10:30", "Call Anna at 3pm", "Déjeuner à midi", "Rappeler à 18 heures", "Point à 9h30"]) expect(namesTime(s), s).toBe(true);
    for (const s of ["Appeler Marc lundi", "Envoyer le devis vendredi", "Call Anna tomorrow", "Préparer le H2", "Lire 2 chapitres"]) expect(namesTime(s), s).toBe(false);
  });

  it("marks each commitment with whether its time was said", () => {
    const out = adviseFor(input({ notes: [note("a", "next", 2, "Appeler Marc vendredi"), note("b", "next", 2, "Appeler Anna vendredi à 15h")] }));
    const timed = Object.fromEntries(out.filter((x) => x.kind === "commitment").map((x) => [x.noteIds[0], x.facts.timed]));
    expect(timed).toEqual({ a: 0, b: 1 });
  });
});
