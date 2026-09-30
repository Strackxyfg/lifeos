import { describe, expect, it } from "vitest";
import { hubBadges, hubStats, type HubFacts } from "@/lib/hub/summary";

const facts = (over: Partial<HubFacts> = {}): HubFacts => ({
  notes: 12,
  links: 7,
  reviewDue: 2,
  tensions: 1,
  unreviewed: 0,
  toConfirm: 0,
  tasksOpen: 3,
  tasksDone: 1,
  reminders: null,
  projects: { active: 2, blocked: 0, avgProgress: 40 },
  deals: { open: 1, openValue: 1000 },
  finance: { income: 0, expense: 0, net: 0 },
  team: null,
  ...over,
});

describe("the second brain's building", () => {
  it("counts what waits there: reviews, tensions, and what the double waits to hear", () => {
    expect(hubBadges(facts()).brain).toBe(3);
    expect(hubBadges(facts({ toConfirm: 2 })).brain).toBe(5);
  });

  it("shows the observations to confirm in place of the connections, only when there are some", () => {
    expect(hubStats("brain", facts()).map((s) => s.key)).toEqual(["notes", "links", "reviewDue", "tensions"]);
    const waiting = hubStats("brain", facts({ toConfirm: 2 }));
    expect(waiting.map((s) => s.key)).toEqual(["notes", "toConfirm", "reviewDue", "tensions"]);
    expect(waiting[1]).toEqual({ key: "toConfirm", value: 2, format: "count", alert: true });
    // Never more than the four the panel lays out.
    expect(waiting.length).toBeLessThanOrEqual(4);
  });
});
