import { describe, it, expect } from "vitest";
import { locateQuote, toAudioWords, wordsIn, type AudioWord } from "@/lib/voice/align";
import { stripWordHallucinations } from "@/lib/ai/transcript";
import { parseRange } from "@/lib/voice/range";
import { titleFromSpeech } from "@/lib/brain/recordings";

/** Words spoken one after another, 300 ms each, from a text. */
function spoken(text: string, from = 0): AudioWord[] {
  return text.split(/\s+/).map((w, i) => ({ w, s: from + i * 300, e: from + i * 300 + 280 }));
}

// The shape of a real memo: filler, false starts, several ideas.
const memo = spoken(
  "Bon, alors, euh, plusieurs choses. Je veux lancer un podcast sur l'entrepreneuriat d'ici la fin de l'année. " +
    "Il faut que j'appelle Marc lundi pour le devis du site. Il est trop cher, je pourrais lui proposer un paiement en trois fois."
);

describe("finding where something was said", () => {
  it("places an exact quote on its words", () => {
    const p = locateQuote(memo, "Il faut que j'appelle Marc lundi pour le devis du site");
    const said = wordsIn(memo, p!.start, p!.end).map((w) => w.w).join(" ");
    expect(said).toBe("Il faut que j'appelle Marc lundi pour le devis du site.");
    expect(p!.coverage).toBe(1);
  });

  it("finds a quote the model cleaned up: filler dropped, punctuation and accents changed", () => {
    const p = locateQuote(memo, "bon alors plusieurs choses");
    expect(wordsIn(memo, p!.start, p!.end)[0].w).toBe("Bon,");
    const q = locateQuote(memo, "je veux lancer un podcast sur l'entreprenariat, d'ici la fin de l'annee");
    expect(q).not.toBeNull();
    expect(wordsIn(memo, q!.start, q!.end).map((w) => w.w).at(-1)).toBe("l'année.");
  });

  it("does not place a paraphrase", () => {
    expect(locateQuote(memo, "Négocier le prix du site avec le prestataire")).toBeNull();
    expect(locateQuote(memo, "")).toBeNull();
    expect(locateQuote([], "Marc lundi")).toBeNull();
  });

  it("keeps the passage to what was quoted, not the whole sentence around it", () => {
    const p = locateQuote(memo, "proposer un paiement en trois fois");
    const said = wordsIn(memo, p!.start, p!.end).map((w) => w.w);
    expect(said[0]).toBe("proposer");
    expect(said.at(-1)).toBe("fois.");
  });

  it("stays fast on a five-minute memo", () => {
    const long = spoken(Array.from({ length: 900 }, (_, i) => `mot${i % 97}`).join(" ") + " la phrase cherchée ici enfin");
    const t0 = performance.now();
    const p = locateQuote(long, "la phrase cherchée ici enfin");
    expect(performance.now() - t0).toBeLessThan(200);
    expect(p?.coverage).toBe(1);
  });
});

describe("words from Whisper", () => {
  it("converts seconds to milliseconds and drops what is not a word", () => {
    expect(
      toAudioWords([
        { word: " Bon,", start: 0.18, end: 0.72 },
        { word: "", start: 1, end: 2 },
        { word: "x", start: 2, end: 1 },
        { word: "alors", start: Number.NaN, end: 1 },
        null,
        { word: "voilà", start: 0.9, end: 1.2 },
      ])
    ).toEqual([
      { w: "Bon,", s: 180, e: 720 },
      { w: "voilà", s: 900, e: 1200 },
    ]);
    expect(toAudioWords("nope")).toEqual([]);
  });

  it("drops the credits Whisper invents on silence, with their timings", () => {
    const heard = [...spoken("Il faut appeler Marc lundi."), ...spoken("Sous-titrage Société Radio-Canada", 5_000)];
    expect(stripWordHallucinations(heard).map((w) => w.w).join(" ")).toBe("Il faut appeler Marc lundi.");
  });
});


describe("byte ranges for seeking in a recording", () => {
  it("serves the whole file without a range", () => {
    expect(parseRange(null, 1000)).toBeNull();
  });

  it("reads the forms media elements send", () => {
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("refuses what cannot be served", () => {
    for (const bad of ["bytes=1000-", "bytes=500-100", "bytes=-0", "bytes=-", "items=0-1", "bytes=0-1,5-6", "bytes=abc-"]) {
      expect(parseRange(bad, 1000)).toBe("invalid");
    }
    expect(parseRange("bytes=0-", 0)).toBe("invalid");
  });
});

describe("a voice note's title", () => {
  it("skips an opening that says nothing, and keeps the whole memo as detail", () => {
    const memo = "Bon, alors, plusieurs choses. Je veux lancer un podcast sur l'entrepreneuriat. Il faut appeler Marc.";
    expect(titleFromSpeech(memo)).toEqual({ title: "Je veux lancer un podcast sur l'entrepreneuriat.", detail: memo });
  });

  it("uses a short note as it is, with no detail", () => {
    expect(titleFromSpeech("Relancer Marc pour le devis.")).toEqual({ title: "Relancer Marc pour le devis.", detail: null });
    expect(titleFromSpeech("Acheter du pain")).toEqual({ title: "Acheter du pain", detail: null });
  });

  it("clips a long first sentence and keeps it whole in the detail", () => {
    const long = `Je pense que ${"vraiment beaucoup de choses ".repeat(10)}comptent.`;
    const r = titleFromSpeech(long);
    expect(r.title.length).toBeLessThanOrEqual(140);
    expect(r.detail).toBe(long);
  });
});
