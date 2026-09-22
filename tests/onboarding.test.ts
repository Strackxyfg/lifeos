import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AREA_IDS,
  LIMITS,
  onboardingSchema,
  questions,
  readProfileAnswers,
  splitThoughts,
  starterBrain,
  type OnboardingAnswers,
} from "@/lib/onboarding";
import { heuristicRegion } from "@/lib/brain/classify";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { GENERATION_STEPS } from "@/lib/notion/phases";

const base: OnboardingAnswers = {
  name: "Camille",
  profession: "Fondatrice d'une agence",
  goal: "Signer 10 clients d'ici décembre",
  step: "",
  goal2: "",
  mind: "",
  areas: [],
};

describe("onboarding answers", () => {
  it("requires a name, a profession and a goal — and only those", () => {
    expect(onboardingSchema.safeParse({ name: "A", profession: "B", goal: "C" }).success).toBe(true);
    for (const missing of ["name", "profession", "goal"] as const) {
      const input = { name: "A", profession: "B", goal: "C", [missing]: "   " };
      expect(onboardingSchema.safeParse(input).success, missing).toBe(false);
    }
  });

  it("trims text and fills the optional answers with defaults", () => {
    const parsed = onboardingSchema.parse({ name: "  Camille  ", profession: "x", goal: " y " });
    expect(parsed).toMatchObject({ name: "Camille", goal: "y", step: "", goal2: "", mind: "", areas: [] });
  });

  it("rejects areas it does not know, and over-long answers", () => {
    expect(onboardingSchema.safeParse({ ...base, areas: ["clients", "yachts"] }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, goal: "x".repeat(LIMITS.goal + 1) }).success).toBe(false);
  });

  it("asks exactly the questions the schema defines, each once", () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(onboardingSchema.shape).sort());
  });

  it("has every question and area worded in both languages", () => {
    for (const locale of ["en", "fr"] as const) {
      const t = dictionaries[locale].onboarding;
      for (const q of questions) {
        expect(t.q[q.id].title, `${locale} ${q.id}`).toBeTruthy();
        expect(t.q[q.id].subtitle, `${locale} ${q.id}`).toBeTruthy();
      }
      for (const a of AREA_IDS) expect(t.areas[a], `${locale} ${a}`).toBeTruthy();
      // The next-step question names the goal it serves.
      expect(t.q.step.title).toContain("{goal}");
    }
  });
});

describe("what's on your mind → notes", () => {
  it("makes one note per line, without list markers", () => {
    expect(splitThoughts("- Idée : parrainage\n• Appeler le comptable\n1. Lire Deep Work\n[ ] Renouveler le domaine")).toEqual([
      "Idée : parrainage",
      "Appeler le comptable",
      "Lire Deep Work",
      "Renouveler le domaine",
    ]);
  });

  it("drops blank lines and repeats, ignoring case and accents", () => {
    expect(splitThoughts("Idée\n\n   \nidee\nIDÉE\nautre chose\r\n")).toEqual(["Idée", "autre chose"]);
  });

  it("caps the number of notes — onboarding is not a bulk import", () => {
    const many = Array.from({ length: 20 }, (_, i) => `pensée numéro ${i}`).join("\n");
    expect(splitThoughts(many)).toHaveLength(LIMITS.mindLines);
  });

  it("clips a line to the brain's title limit", () => {
    expect(splitThoughts("x".repeat(900))[0]).toHaveLength(LIMITS.noteTitle);
  });
});

describe("the starting brain", () => {
  it("files the goal and connects the next step to it", () => {
    const plan = starterBrain({ ...base, step: "Appeler Marc mardi" }, heuristicRegion);
    expect(plan.notes).toEqual([
      { key: "goal", title: base.goal, category: "goals" },
      { key: "step", title: "Appeler Marc mardi", category: "next" },
    ]);
    expect(plan.links).toEqual([["step", "goal"]]);
  });

  it("creates no link when there is no next step", () => {
    const plan = starterBrain(base, heuristicRegion);
    expect(plan.notes).toHaveLength(1);
    expect(plan.links).toEqual([]);
  });

  it("never files the same thing twice", () => {
    const plan = starterBrain(
      { ...base, step: "signer 10 clients d'ici DECEMBRE", goal2: base.goal, mind: `${base.goal}\nautre` },
      heuristicRegion
    );
    expect(plan.notes.map((n) => n.title)).toEqual([base.goal, "autre"]);
    // The repeated "step" was dropped, so it cannot be linked either.
    expect(plan.links).toEqual([]);
  });

  it("files each thought by what it says", () => {
    const plan = starterBrain(
      { ...base, mind: "Idée : un programme de parrainage\nAppeler le comptable\nJe réfléchis mieux le matin" },
      heuristicRegion
    );
    const byTitle = Object.fromEntries(plan.notes.map((n) => [n.title, n.category]));
    expect(byTitle["Idée : un programme de parrainage"]).toBe("ideas");
    expect(byTitle["Appeler le comptable"]).toBe("next");
    expect(byTitle["Je réfléchis mieux le matin"]).toBe("thoughts");
  });

  it("gives every planned note a unique key, so links cannot cross wires", () => {
    const plan = starterBrain(
      { ...base, step: "a", goal2: "b", mind: "c\nd\ne" },
      () => "thoughts"
    );
    const keys = plan.notes.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of plan.links) {
      expect(keys).toContain(a);
      expect(keys).toContain(b);
    }
  });
});

describe("stored profile answers", () => {
  it("reads what was saved", () => {
    expect(readProfileAnswers({ areas: ["clients", "money"] })).toEqual({ areas: ["clients", "money"] });
  });

  it("survives a malformed or missing row instead of crashing the layout", () => {
    expect(readProfileAnswers(null)).toEqual({ areas: [] });
    expect(readProfileAnswers({ areas: "clients" })).toEqual({ areas: [] });
    // One unknown area must not cost the person the valid ones.
    expect(readProfileAnswers({ areas: ["clients", "yachts"] })).toEqual({ areas: ["clients"] });
  });
});

describe("the Notion export shows only what it does", () => {
  const src = readFileSync(join(__dirname, "..", "lib", "notion", "generate.ts"), "utf8");
  const emitted = new Set([...src.matchAll(/emit\("([a-z]+)"/g)].map((m) => m[1]));

  it("lists exactly the steps the generator performs", () => {
    // It once ticked off "Connecting calendars" and "Training your AI
    // assistant", neither of which the generator did.
    expect(emitted).toEqual(new Set([...GENERATION_STEPS, "done"]));
  });

  it("names every step in both languages", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const s of GENERATION_STEPS) expect(dictionaries[locale].notionBuild.steps[s]).toBeTruthy();
    }
  });
});
