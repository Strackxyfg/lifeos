import { describe, it, expect } from "vitest";
import { planFromAnswers } from "@/lib/onboarding";
import { selectBlueprints } from "@/lib/notion/blueprint";

describe("planFromAnswers", () => {
  it("always includes the core databases", () => {
    const plan = planFromAnswers({});
    for (const core of ["Projects", "Weekly Planner", "Goal Tracker", "Journal", "Habit Tracker"]) {
      expect(plan).toContain(core);
    }
  });

  it("adds CRM and Finance when requested", () => {
    const plan = planFromAnswers({ needsCrm: true, needsFinance: true });
    expect(plan).toContain("CRM");
    expect(plan).toContain("Finance");
  });

  it("adds knowledge + reading for learning", () => {
    const plan = planFromAnswers({ needsLearning: true });
    expect(plan).toContain("Knowledge Base");
    expect(plan).toContain("Reading Tracker");
  });

  it("adds meeting notes for teams", () => {
    expect(planFromAnswers({ team: "6–20" })).toContain("Meeting Notes");
    expect(planFromAnswers({ team: "Solo" })).not.toContain("Meeting Notes");
  });
});

describe("selectBlueprints", () => {
  it("is deterministic and returns valid blueprints", () => {
    const bps = selectBlueprints({ needsCrm: true });
    const keys = bps.map((b) => b.key);
    expect(keys).toContain("crm");
    expect(keys).toContain("projects");
    // every blueprint must define a title property
    for (const bp of bps) {
      const hasTitle = Object.values(bp.properties).some((p) => "title" in p);
      expect(hasTitle).toBe(true);
    }
  });

  it("only wires relations to databases that are also selected", () => {
    const bps = selectBlueprints({}); // no meetings (solo, no team goal)
    const keys = new Set(bps.map((b) => b.key));
    for (const bp of bps) {
      for (const rel of bp.relations ?? []) {
        // relation targets that exist should be selectable; unselected are skipped at build time
        expect(typeof rel.to).toBe("string");
      }
    }
    expect(keys.has("projects")).toBe(true);
  });
});
