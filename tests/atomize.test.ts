import { describe, it, expect } from "vitest";
import { ATOMIZE_LIMITS, dumpLanguage, grounded, keepAtoms, prepareDump, sanitizeAtoms, splitDump } from "@/lib/brain/atomize";
import { createQuota } from "@/lib/ai/quota";
import { stripHallucinations } from "@/lib/ai/transcript";

describe("sanitizeAtoms", () => {
  it("keeps valid atoms and relations, numbered from 1 by the model", () => {
    const r = sanitizeAtoms({
      notes: [
        { title: "Signer 10 clients d'ici décembre", region: "goals" },
        { title: "Appeler Marc lundi", detail: "au sujet du devis", region: "next" },
      ],
      relations: [{ a: 2, b: 1, kind: "advances", reason: "L'appel peut signer un client." }],
    });
    expect(r.atoms).toEqual([
      { title: "Signer 10 clients d'ici décembre", detail: null, region: "goals" },
      { title: "Appeler Marc lundi", detail: "au sujet du devis", region: "next" },
    ]);
    expect(r.relations).toEqual([{ a: 1, b: 0, kind: "advances", from: 1, reason: "L'appel peut signer un client." }]);
  });

  it("drops empty or tiny titles, and defaults an unknown region to thoughts", () => {
    const r = sanitizeAtoms({ notes: [{ title: "" }, { title: "ok" }, { title: "  Une idée  ", region: "banana" }, null, 42] });
    expect(r.atoms).toEqual([{ title: "Une idée", detail: null, region: "thoughts" }]);
  });

  it("merges repeats ignoring case and accents, and remaps their relations", () => {
    const r = sanitizeAtoms({
      notes: [{ title: "Idée de podcast" }, { title: "Lancer la newsletter" }, { title: "IDEE DE PODCAST" }],
      relations: [
        { a: 3, b: 2, kind: "supports" },
        // The same pair again, through the repeat: kept once.
        { a: 1, b: 2, kind: "extends" },
      ],
    });
    expect(r.atoms.map((a) => a.title)).toEqual(["Idée de podcast", "Lancer la newsletter"]);
    expect(r.relations).toHaveLength(1);
    expect(r.relations[0]).toMatchObject({ a: 0, b: 1, kind: "supports", from: 0 });
  });

  it("refuses relations to itself, to missing atoms, and of unknown kinds", () => {
    const r = sanitizeAtoms({
      notes: [{ title: "Première note" }, { title: "Deuxième note" }],
      relations: [
        { a: 1, b: 1, kind: "supports" },
        { a: 1, b: 9, kind: "supports" },
        { a: "2", b: "1", kind: "INVENTED" },
      ],
    });
    expect(r.relations).toEqual([{ a: 1, b: 0, kind: "related", from: null, reason: "" }]);
  });

  it("reads directions from named roles, the first role being the source", () => {
    const r = sanitizeAtoms({
      notes: [{ title: "Proposer un paiement en trois fois" }, { title: "Le devis est trop cher" }, { title: "Signer Marc" }, { title: "Aller vite" }],
      relations: [
        { kind: "supports", evidence: 2, claim: 1, reason: "Le prix motive l'offre." },
        { kind: "advances", goal: 3, step: 1 },
        { kind: "tension", notes: [4, 2] },
      ],
    });
    expect(r.relations).toEqual([
      { a: 1, b: 0, kind: "supports", from: 1, reason: "Le prix motive l'offre." },
      { a: 0, b: 2, kind: "advances", from: 0, reason: "" },
      { a: 3, b: 1, kind: "tension", from: null, reason: "" },
    ]);
  });

  it("gives undirected kinds no source", () => {
    const r = sanitizeAtoms({ notes: [{ title: "Aller vite" }, { title: "Tout vérifier" }], relations: [{ a: 1, b: 2, kind: "tension" }] });
    expect(r.relations[0].from).toBeNull();
  });

  it("accepts the other shapes models use, and never throws", () => {
    expect(sanitizeAtoms({ atoms: [{ title: "Une note" }], links: [] }).atoms).toHaveLength(1);
    for (const junk of [null, undefined, "text", 3, [], { notes: "x" }, { notes: [{ title: 5 }] }]) {
      expect(sanitizeAtoms(junk)).toEqual({ atoms: [], relations: [] });
    }
  });

  it("caps the number of atoms and clips long fields", () => {
    const notes = Array.from({ length: 30 }, (_, i) => ({ title: `Note numéro ${i} ${"x".repeat(300)}`, detail: "d".repeat(900) }));
    const r = sanitizeAtoms({ notes });
    expect(r.atoms).toHaveLength(ATOMIZE_LIMITS.atoms);
    expect(r.atoms.every((a) => a.title.length <= ATOMIZE_LIMITS.title && (a.detail?.length ?? 0) <= ATOMIZE_LIMITS.detail)).toBe(true);
    expect(sanitizeAtoms({ notes }, 20).atoms).toHaveLength(20);
  });
});

describe("grounding in the dump", () => {
  const memo =
    "Je veux lancer un podcast sur l'entrepreneuriat d'ici la fin de l'année. Il faut que j'appelle Marc lundi pour le devis du site. " +
    "Il est trop cher, je pourrais lui proposer un paiement en trois fois. Je travaille beaucoup mieux le matin. " +
    "Je devrais bloquer mes matinées pour le travail profond. Ah, et le podcast pourrait aussi m'aider à trouver des clients.";

  it("rejects the link the model invented on a real memo", () => {
    // "The site is needed for the podcast": no words of the memo say so.
    expect(grounded("Il faut que j'appelle Marc lundi pour le devis du site", memo, "Appeler Marc lundi pour le devis du site", "Lancer un podcast sur l'entrepreneuriat")).toBe(false);
    expect(grounded("le site est nécessaire pour lancer le podcast", memo, "Appeler Marc lundi", "Lancer un podcast")).toBe(false);
    // The quote the model actually gave: two neighbouring sentences that share no word.
    const both = "Je veux lancer un podcast sur l'entrepreneuriat d'ici la fin de l'année. Il faut que j'appelle Marc lundi pour le devis du site";
    expect(grounded(both, memo, "Appeler Marc lundi pour le devis du site", "Lancer un podcast sur l'entrepreneuriat")).toBe(false);
    expect(grounded("lancer un podcast … j'appelle Marc lundi", memo, "Appeler Marc lundi", "Lancer un podcast")).toBe(false);
  });

  it("leaves inferences to weaving: two sentences without a shared word are not a stated link", () => {
    const call = "Churn is at 7% monthly, mostly small teams in their first month. She thinks onboarding is too long.";
    expect(grounded("churn is at 7% monthly... She thinks onboarding is too long", call, "Churn is at 7% monthly", "Priya thinks onboarding is too long")).toBe(false);
  });

  it("keeps links the person actually made, across accents, cases and fragments", () => {
    expect(grounded("Il est trop cher, je pourrais lui proposer un paiement en trois fois", memo, "Le devis du site est trop cher", "Je pourrais proposer un paiement en trois fois")).toBe(true);
    expect(grounded("je travaille beaucoup mieux le matin … bloquer mes MATINEES", memo, "Je travaille beaucoup mieux le matin", "Je devrais bloquer mes matinées")).toBe(true);
    expect(grounded("le podcast pourrait aussi m'aider à trouver des clients", memo, "Le podcast pourrait m'aider à trouver des clients", "Lancer un podcast sur l'entrepreneuriat")).toBe(true);
  });

  it("reads a short hinge in its sentence, not on its own", () => {
    const dump =
      "j'ai envie de voyager plus cette année, genre le Japon, mais en même temps je veux mettre de côté pour l'apport de l'appart. faut que je fasse un budget.";
    expect(grounded("mais en même temps", dump, "Voyager plus cette année", "Mettre de côté pour l'apport de l'appart")).toBe(true);
    // The budget sentence does not mention travel: the model's inference, not the person's.
    expect(grounded("faut que je fasse un budget", dump, "Faire un budget", "Voyager plus cette année")).toBe(false);
  });

  it("bounds a run-on transcript with no full stops", () => {
    const runOn = `je veux lancer un podcast ${"et puis bon ".repeat(40)}il faut appeler marc pour le devis`;
    expect(grounded("il faut appeler marc", runOn, "Appeler Marc pour le devis", "Lancer un podcast")).toBe(false);
    expect(grounded("il faut appeler marc", runOn, "Appeler Marc pour le devis", "Le devis de Marc")).toBe(true);
  });

  it("refuses empty quotes and partial words", () => {
    expect(grounded("", memo, "Lancer un podcast", "Trouver des clients")).toBe(false);
    expect(grounded("podca", memo, "Lancer un podcast", "Le podcast pourrait m'aider")).toBe(false);
  });

  it("drops ungrounded relations and invented atoms when the source is given", () => {
    const r = sanitizeAtoms(
      {
        notes: [
          { title: "Lancer un podcast sur l'entrepreneuriat" },
          { title: "Appeler Marc lundi pour le devis du site" },
          { title: "Le podcast pourrait m'aider à trouver des clients" },
          { title: "Embaucher une assistante virtuelle" },
        ],
        relations: [
          { kind: "advances", step: 2, goal: 1, said: "Il faut que j'appelle Marc lundi", reason: "Le site sert le podcast." },
          { kind: "supports", evidence: 3, claim: 1, said: "le podcast pourrait aussi m'aider à trouver des clients" },
        ],
      },
      12,
      memo
    );
    expect(r.atoms.map((a) => a.title)).not.toContain("Embaucher une assistante virtuelle");
    expect(r.relations).toEqual([{ a: 2, b: 0, kind: "supports", from: 2, reason: "" }]);
  });
});

describe("dumpLanguage", () => {
  it("tells French from English by their function words", () => {
    expect(dumpLanguage("Notes from the call with Priya: churn is at 7% monthly, mostly small teams in their first month.")).toBe("en");
    expect(dumpLanguage("euh je sais pas trop, j'ai envie de voyager plus cette année, mais je veux mettre de côté")).toBe("fr");
  });

  it("declines to guess on too little or too mixed text", () => {
    expect(dumpLanguage("Podcast Marc")).toBeNull();
    expect(dumpLanguage("the meeting et le budget and the plan pour le client")).toBeNull();
  });
});

describe("prepareDump", () => {
  it("tidies whitespace and bounds the length", () => {
    expect(prepareDump("  a\r\n\r\n\r\n\r\nb \t c  ")).toBe("a\n\nb c");
    expect(prepareDump("y".repeat(10_000))).toHaveLength(ATOMIZE_LIMITS.inputChars);
  });
});

describe("splitDump — without a model", () => {
  it("splits lines and bullets, and files each by the rules", () => {
    const r = splitDump("- Objectif : courir un semi-marathon\n- Acheter des chaussures de trail\n\n• Idée : un club de course au bureau");
    expect(r.atoms.map((a) => a.title)).toEqual([
      "Objectif : courir un semi-marathon",
      "Acheter des chaussures de trail",
      "Idée : un club de course au bureau",
    ]);
    expect(r.atoms[0].region).toBe("goals");
    expect(r.relations).toEqual([]);
  });

  it("splits a single paragraph into sentences", () => {
    const r = splitDump("Je dois rappeler Marc. Le devis est trop cher ! Peut-être proposer un paiement en trois fois…");
    expect(r.atoms.map((a) => a.title)).toEqual([
      "Je dois rappeler Marc.",
      "Le devis est trop cher !",
      "Peut-être proposer un paiement en trois fois…",
    ]);
  });

  it("does not split on abbreviations followed by lowercase", () => {
    expect(splitDump("Voir p. ex. le rapport de mars.").atoms).toHaveLength(1);
  });

  it("loses nothing: a long line keeps its full text, many lines are grouped", () => {
    const long = `Une très longue réflexion ${"mot ".repeat(80)}fin`;
    const r1 = splitDump(`${long}\nCourt`);
    expect(r1.atoms[0].detail).toContain("fin");

    const lines = Array.from({ length: 45 }, (_, i) => `Ligne numéro ${i + 1}`);
    const r2 = splitDump(lines.join("\n"));
    expect(r2.atoms.length).toBeLessThanOrEqual(ATOMIZE_LIMITS.saved);
    const all = r2.atoms.flatMap((a) => [a.title, ...(a.detail ?? "").split("\n")]).filter(Boolean);
    expect(new Set(all)).toEqual(new Set(lines));
  });

  it("returns nothing for blank input", () => {
    expect(splitDump("   \n\n ")).toEqual({ atoms: [], relations: [] });
  });
});

describe("keepAtoms", () => {
  const result = sanitizeAtoms({
    notes: [{ title: "Note A" }, { title: "Note B" }, { title: "Note C" }],
    relations: [
      { a: 1, b: 2, kind: "supports" },
      { a: 3, b: 2, kind: "advances" },
      { a: 1, b: 3, kind: "tension" },
    ],
  });

  it("renumbers the relations between the atoms kept", () => {
    const r = keepAtoms(result, [false, true, true]);
    expect(r.atoms.map((a) => a.title)).toEqual(["Note B", "Note C"]);
    expect(r.relations).toEqual([{ a: 1, b: 0, kind: "advances", from: 1, reason: "" }]);
  });

  it("keeps everything when everything is kept, and nothing when nothing is", () => {
    expect(keepAtoms(result, [true, true, true])).toEqual(result);
    expect(keepAtoms(result, [])).toEqual({ atoms: [], relations: [] });
  });
});

describe("quota", () => {
  it("allows the limit per window, per person and per kind, then says when to retry", () => {
    let t = 0;
    const q = createQuota(
      {
        transcribe: { limit: 2, windowMs: 1000 },
        atomize: { limit: 1, windowMs: 1000 },
        decide: { limit: 1, windowMs: 1000 },
        portrait: { limit: 1, windowMs: 1000 },
        double: { limit: 1, windowMs: 1000 },
      },
      () => t
    );
    expect(q.take("ana", "transcribe").ok).toBe(true);
    t = 100;
    expect(q.take("ana", "transcribe").ok).toBe(true);
    t = 200;
    const refused = q.take("ana", "transcribe");
    expect(refused).toEqual({ ok: false, retryAfterMs: 800 });
    // Someone else, or another kind of call, is counted apart.
    expect(q.take("ben", "transcribe").ok).toBe(true);
    expect(q.take("ana", "atomize").ok).toBe(true);
    // The window slides: the first call ages out at t=1000.
    t = 1001;
    expect(q.take("ana", "transcribe").ok).toBe(true);
    expect(q.take("ana", "transcribe").ok).toBe(false);
  });
});

describe("stripHallucinations", () => {
  it("removes the credits Whisper invents on silence, as seen on a real memo", () => {
    const heard =
      "Il faut que j'appelle Marc lundi pour le devis du site. Ah, et le podcast pourrait m'aider à trouver des clients. Sous-titrage Société Radio-Canada";
    expect(stripHallucinations(heard)).toBe(
      "Il faut que j'appelle Marc lundi pour le devis du site. Ah, et le podcast pourrait m'aider à trouver des clients."
    );
  });

  it("handles several, at either end, in both languages", () => {
    expect(stripHallucinations("Thanks for watching! Call the bank. Subtitles by the Amara.org community")).toBe("Call the bank.");
    expect(stripHallucinations("Sous-titres réalisés par la communauté d'Amara.org. Merci d'avoir regardé cette vidéo !")).toBe("");
  });

  it("keeps the same words when the person said them mid-thought", () => {
    const said = "Au début je dis merci d'avoir regardé. Merci d'avoir regardé. Puis je parle du lancement.";
    expect(stripHallucinations(said)).toBe(said);
    expect(stripHallucinations("  Je veux m'abonner à la chaîne de Marc.  ")).toBe("Je veux m'abonner à la chaîne de Marc.");
  });
});
