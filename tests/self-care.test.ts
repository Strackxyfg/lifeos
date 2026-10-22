import { describe, expect, it } from "vitest";
import { careLevel, careOf } from "@/lib/self/care";
import { registerOf, selfGender } from "@/lib/self/voice";

/**
 * Reading how heavy a message is, without a model. A crisis must never be
 * missed for want of an accent or a curly apostrophe; an idiom must not
 * turn a bad day into an alarm.
 */

describe("a crisis", () => {
  const crisis = [
    "Je pense au suicide depuis quelques jours",
    "j'ai envie d’en finir",
    "J'ai envie d'en finir.",
    "je veux en finir avec la vie",
    "Je veux en finir avec tout ça",
    "je n'ai plus envie de vivre",
    "Je ne veux plus vivre comme ça",
    "j'ai envie de mourir",
    "je voudrais ne plus être là",
    "parfois j'aimerais être morte",
    "j'ai envie de me faire du mal",
    "je pense à me tuer",
    "je vais finir par me suicider",
    "je me scarifie le soir",
    "J'aimerais m'endormir et ne plus me réveiller",
    "personne ne me regretterait",
    "Je vais me foutre en l'air",
    "I want to kill myself",
    "I just want to end it all",
    "honestly I don't want to be alive anymore",
    "I wish I was dead",
    "I keep hurting myself",
    "thinking about self-harm again",
    "everyone would be better off dead without me — me included",
  ];
  it.each(crisis)("is read in « %s »", (text) => expect(careLevel(text)).toBe("crisis"));

  const idioms = [
    "Je vais me tuer à la tâche sur ce projet",
    "Ma mère va me tuer si j'oublie son anniversaire",
    "Ce dossier me tue",
    "j'ai hâte d'en finir avec ce dossier",
    "je veux en finir avec mes dettes",
    "On va en finir avec cette réunion",
    "je suis mort de rire",
    "je voudrais être là pour mes enfants",
    "This deadline is killing me",
    "I'm going to die of embarrassment",
    "Je tue le temps en lisant",
  ];
  it.each(idioms)("is not read in the idiom « %s »", (text) => expect(careLevel(text)).not.toBe("crisis"));
});

describe("distress", () => {
  const hard = [
    "Je me sens vraiment mal en ce moment",
    "je n'en peux plus de ce boulot",
    "J'en peux plus",
    "je suis à bout",
    "J'ai fait une crise d'angoisse hier",
    "je crois que je fais un burn-out",
    "je rate tout et je déçois tout le monde",
    "je ne dors plus",
    "I feel like a failure",
    "I'm so overwhelmed",
    "I can't cope anymore",
  ];
  it.each(hard)("is read in « %s »", (text) => expect(careLevel(text)).toBe("distress"));

  it("is not read in an ordinary message", () => {
    for (const text of ["Sur quoi devrais-je me concentrer cette semaine ?", "Le matin, vers 8h", "What should I focus on?", ""]) expect(careLevel(text)).toBe("none");
  });

  it("holds through the next message: a crisis said a moment ago is not over", () => {
    expect(careOf(["j'ai envie d'en finir", "oui"])).toBe("crisis");
    expect(careOf(["je suis à bout", "ok"])).toBe("distress");
    expect(careOf(["j'ai envie d'en finir", "ça va mieux", "merci, on parle du projet ?"])).toBe("none");
  });
});

describe("the register", () => {
  it("answers « tu » to someone who writes « tu », « vous » otherwise", () => {
    expect(registerOf(["J'ai besoin que tu m'aides"])).toBe("tu");
    expect(registerOf(["t'as une idée ?"])).toBe("tu");
    expect(registerOf(["Qu'en pensez-vous ?"])).toBe("vous");
    expect(registerOf(["Le matin, vers 8h"])).toBe("vous");
    expect(registerOf(["Aide-moi toi", "vous savez, les clients…"])).toBe("tu");
    // A word that contains "tu" is not "tu".
    expect(registerOf(["La situation actuelle"])).toBe("vous");
  });
});

describe("how they speak of themselves", () => {
  it("is read from their own first-person sentences only", () => {
    expect(selfGender(["Quand je me suis livré à lui, il n'a rien fait"])).toBe("m");
    expect(selfGender(["Je suis épuisée ce soir", "je me sens seule"])).toBe("f");
    expect(selfGender(["Je suis vraiment fier de ce projet"])).toBe("m");
    expect(selfGender(["je suis tellement contente"])).toBe("f");
    expect(selfGender(["Je travaille mieux le matin", "Appeler Marc pour le devis"])).toBeNull();
    // Written both ways on purpose, or both forms in different sentences: no reading.
    expect(selfGender(["je suis allé(e) voir Marc"])).toBeNull();
    expect(selfGender(["je suis prêt·e"])).toBeNull();
    expect(selfGender(["je suis fatigué", "je suis fatiguée"])).toBeNull();
    // Someone else's agreement says nothing about them.
    expect(selfGender(["Marc est épuisé", "elle est contente"])).toBeNull();
  });
});
