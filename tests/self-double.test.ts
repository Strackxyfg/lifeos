import { describe, expect, it } from "vitest";
import {
  ACTIONS_CLOSE,
  ACTIONS_OPEN,
  doubleSystem,
  goalRefs,
  isDoubleAction,
  parseDoubleActions,
  portraitSection,
  rhythmSection,
  tidyAnswer,
  visibleAnswer,
} from "@/lib/self/double";
import { neutralFrench } from "@/lib/self/voice";
import { portraitOf, traitKey, type TraitLike } from "@/lib/self/portrait";
import { summarize } from "@/lib/self/rhythm";

const goals = new Map([["g1", "goal-1"]]);
const answer = (block: string) => `Vous avancez bien.\n\n${ACTIONS_OPEN}\n${block}\n${ACTIONS_CLOSE}`;

describe("what the person sees while it streams", () => {
  it("hides the actions block, and the first letters of its marker as they arrive", () => {
    expect(visibleAnswer(answer("[]"))).toBe("Vous avancez bien.");
    expect(visibleAnswer("Vous avancez bien.\n\n<<AC")).toBe("Vous avancez bien.");
    expect(visibleAnswer("Vous avancez bien. <")).toBe("Vous avancez bien.");
    expect(visibleAnswer("Rien de spécial.")).toBe("Rien de spécial.");
  });
});

describe("the actions it proposes", () => {
  it("reads steps, reminders and notes, resolving goal references it was given", () => {
    const out = parseDoubleActions(
      answer(
        '[{"type":"step","title":"Appeler Marc pour le devis","goal":"g1"},{"type":"reminder","title":"Relire le plan","when":"demain à 9h"},{"type":"note","title":"Je décide mieux après une nuit","region":"insights"}]'
      ),
      goals
    );
    expect(out).toEqual([
      { type: "step", title: "Appeler Marc pour le devis", goalId: "goal-1" },
      { type: "reminder", title: "Relire le plan", when: "demain à 9h" },
      { type: "note", title: "Je décide mieux après une nuit", region: "insights" },
    ]);
  });

  it("drops what it cannot trust: unknown types, regions or goals, empty titles, a reminder with no moment", () => {
    const out = parseDoubleActions(
      answer(
        '[{"type":"email","title":"Écrire au client"},{"type":"note","title":"Une note","region":"secrets"},{"type":"step","title":"x"},{"type":"reminder","title":"Sans moment"},{"type":"step","title":"Une étape","goal":"g9"}]'
      ),
      goals
    );
    // The step keeps its title; the goal it named was never given, so it serves none.
    expect(out).toEqual([{ type: "step", title: "Une étape", goalId: null }]);
  });

  it("keeps at most three, without repeats, and survives a block cut short or malformed", () => {
    const five = Array.from({ length: 5 }, (_, i) => `{"type":"step","title":"Étape numéro ${i}"}`).join(",");
    expect(parseDoubleActions(answer(`[${five}]`), goals)).toHaveLength(3);
    expect(parseDoubleActions(answer('[{"type":"step","title":"Même étape"},{"type":"step","title":"même étape"}]'), goals)).toHaveLength(1);
    expect(parseDoubleActions(`Texte ${ACTIONS_OPEN}\n[{"type":"step","title":"Coupé net"}]`, goals)).toHaveLength(1);
    expect(parseDoubleActions(answer("{pas du json"), goals)).toEqual([]);
    expect(parseDoubleActions("Pas de bloc.", goals)).toEqual([]);
  });

  it("checks an accepted action again when the page sends it back", () => {
    expect(isDoubleAction({ type: "step", title: "Appeler Marc", goalId: null })).toBe(true);
    expect(isDoubleAction({ type: "reminder", title: "Relire", when: "demain" })).toBe(true);
    expect(isDoubleAction({ type: "note", title: "Garder", region: "insights" })).toBe(true);
    expect(isDoubleAction({ type: "note", title: "Garder", region: "nope" })).toBe(false);
    expect(isDoubleAction({ type: "delete", title: "Tout" })).toBe(false);
    expect(isDoubleAction({ type: "step", title: "x".repeat(141), goalId: null })).toBe(false);
  });
});

describe("what the double is given", () => {
  const t = (id: string, statement: string, status: TraitLike["status"]): TraitLike => ({
    id,
    dimension: "rhythms",
    statement,
    evidence: [{ noteId: "n", quote: "je travaille mieux le matin" }],
    status,
    origin: "ai",
    key: traitKey(statement),
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  });
  const notes = [{ id: "n", title: "Je travaille mieux le matin", detail: null }];

  it("separates what they confirmed from what they have not, and leaves out what they rejected", () => {
    const text = portraitSection(
      portraitOf([t("a", "Vous travaillez mieux le matin", "confirmed"), t("b", "Vous préférez le calme le matin", "proposed"), t("c", "Vous êtes lent le matin", "rejected")], notes)
    );
    expect(text).toContain("confirmed by them\n- (how they work best) Vous travaillez mieux le matin");
    expect(text).toContain("hold these lightly\n- (how they work best) Vous préférez le calme le matin");
    expect(text).not.toContain("lent");
  });

  it("says plainly when the portrait is empty, and stays within its budget", () => {
    expect(portraitSection(portraitOf([], []))).toContain("empty so far");
    const many = Array.from({ length: 60 }, (_, i) => t(`p${i}`, `Vous aimez la chose numéro ${i} le matin`, "proposed"));
    expect(portraitSection(portraitOf(many, notes), 800).length).toBeLessThanOrEqual(800);
  });

  it("gives check-in figures with how many they rest on, and nothing when there are none", () => {
    expect(rhythmSection(null)).toBeNull();
    const r = summarize(["2026-09-27", "2026-09-28", "2026-09-29"].map((day) => ({ day, hour: 9, mood: 4, energy: 3 })), "2026-09-30");
    expect(rhythmSection(r)).toContain("energy, last 7 days: 3/5 over 3 check-ins");
  });

  it("numbers goals for actions to refer to", () => {
    const { text, refs } = goalRefs([{ id: "x", title: "Signer 10 clients" }]);
    expect(text).toContain("g1: Signer 10 clients");
    expect(refs.get("g1")).toBe("x");
  });

  it("tells the double what it must never do", () => {
    const s = doubleSystem({ language: "French" });
    expect(s).toContain("You do not know their gender");
    expect(doubleSystem({ language: "English" })).not.toContain("gender");
    expect(s).toContain("Never invent a fact about them");
    expect(s).toContain("not a doctor or a therapist");
    expect(s).toContain('"vous"');
  });
});

describe("how the double speaks", () => {
  it("answers what was confided, helps for real, and never opens with a disclaimer", () => {
    const s = doubleSystem({ language: "French" });
    expect(s).toContain("first receive it");
    expect(s).toContain("give 2 or 3 axes");
    expect(s).toContain("Never open with a disclaimer");
    expect(s).not.toContain("suggest they talk to someone qualified");
  });

  it("replies to the question of the day as someone who listened", () => {
    const s = doubleSystem({ language: "French", mode: "answer" });
    expect(s).toContain("They have just answered the question of the day");
    expect(s).toContain("Never talk about traits");
    expect(doubleSystem({ language: "French" })).not.toContain("question of the day");
  });

  it("puts safety first in a crisis: who to call, no plan, no actions", () => {
    const fr = doubleSystem({ language: "French", care: "crisis" });
    expect(fr).toContain("Their safety comes first");
    expect(fr).toContain("3114");
    expect(fr).toContain("whether they are safe right now");
    expect(fr).not.toContain(ACTIONS_OPEN);
    const en = doubleSystem({ language: "English", care: "crisis" });
    expect(en).toContain("988");
    expect(en).toContain("116 123");
    expect(doubleSystem({ language: "French", care: "distress" })).toContain("receive it before anything else");
  });

  it("says « tu » to someone who says « tu », and agrees as they agree with themselves", () => {
    expect(doubleSystem({ language: "French", register: "tu" })).toContain('they say "tu" to you');
    expect(doubleSystem({ language: "French", gender: "m" })).toContain("in the masculine");
    expect(doubleSystem({ language: "French", gender: "f", register: "tu" })).toContain("tu es épuisée");
    expect(doubleSystem({ language: "French", gender: "f" })).not.toContain("You do not know their gender");
    expect(doubleSystem({ language: "French" })).toContain("You do not know their gender");
  });

  it("proposes actions in the conversation's language, never for « now »", () => {
    const en = doubleSystem({ language: "English" });
    expect(en).toContain('"title":"Call Marc about the quote"');
    expect(en).toContain('never "now"');
    expect(en).toContain("Nothing comes after the block");
    expect(doubleSystem({ language: "French" })).toContain('"title":"Appeler Marc pour le devis"');
  });
});

describe("what reaches the page", () => {
  it("is plain text: no actions block, no Markdown", () => {
    expect(tidyAnswer(`## Ce que je vois
1. **Protéger vos matinées** — c'est votre créneau.

${ACTIONS_OPEN}
[]
${ACTIONS_CLOSE}`)).toBe(
      `Ce que je vois
1. Protéger vos matinées — c'est votre créneau.`
    );
  });

  it("assumes no gender when the double does not know it", () => {
    expect(neutralFrench("C'est dur de porter tout ça seul.")).toBe("C'est dur de porter tout ça sans aide.");
    expect(neutralFrench("Vous n'êtes pas seul face à ça.")).toBe("Vous n'êtes pas sans soutien face à ça.");
    expect(neutralFrench("Je suis désolé d'apprendre cela.")).toBe("Je regrette d'apprendre cela.");
    expect(neutralFrench("Je suis vraiment content que tu me le dises.")).toBe("Ça me fait vraiment plaisir que tu me le dises.");
    expect(neutralFrench("je suis touché que vous me le disiez")).toBe("ça me touche que vous me le disiez");
    // Nothing else moves.
    for (const fine of ["Seul compte le premier pas.", "Vous êtes seule juge.", "Je suis là.", "Le seul moyen, c'est d'appeler Marc."]) expect(neutralFrench(fine)).toBe(fine);
  });
});

