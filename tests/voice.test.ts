import { describe, it, expect } from "vitest";
import { MAX_SPOKEN, SentenceStream, rankVoices, sentencesOf, toSpeakable, type VoiceLike } from "@/lib/voice/speech";
import { SpeechQueue, watchdogMs, type UtteranceLike } from "@/lib/voice/queue";

describe("what an answer sounds like", () => {
  it("drops the marks written for the eye", () => {
    expect(
      toSpeakable("**Activer le parrainage** : utilisez « Programme de parrainage » (un mois offert).\n- Relancer Marc\n- Voir https://exemple.fr/x")
    ).toBe("Activer le parrainage : utilisez « Programme de parrainage » (un mois offert). Relancer Marc. Voir.");
  });

  it("gives headings and bullets their pause, and says arrows as a pause", () => {
    expect(toSpeakable("## Plan\n1. Budget → épargne\n---")).toBe("Plan. Budget, épargne.");
  });

  it("removes emoji and link targets, keeps link labels", () => {
    expect(toSpeakable("Bravo 🎉 ! Lisez [le guide](https://exemple.fr/guide) 👍")).toBe("Bravo ! Lisez le guide.");
  });

  it("keeps what is not markup: apostrophes, underscores in words, numbers", () => {
    expect(toSpeakable("L'objectif_2 vaut 3,5 % ou 3.5")).toBe("L'objectif_2 vaut 3,5 % ou 3.5.");
  });
});

describe("sentences, as an answer streams", () => {
  it("hands over each sentence as soon as it is complete", () => {
    const s = new SentenceStream();
    expect(s.push("Bonjour. Je vais")).toEqual(["Bonjour."]);
    expect(s.push(" bien! Et vous")).toEqual(["Je vais bien!"]);
    expect(s.push(" ?")).toEqual([]);
    expect(s.flush()).toEqual(["Et vous ?"]);
  });

  it("waits for what follows a full stop before deciding", () => {
    const s = new SentenceStream();
    expect(s.push("Le taux est de 3.")).toEqual([]);
    expect(s.push("5 pour cent. Fin")).toEqual(["Le taux est de 3.5 pour cent."]);
  });

  it("does not stop at abbreviations and initials", () => {
    expect(sentencesOf("Voir M. Dupont demain. Lire p. ex. le rapport. J. Martin a appelé.")).toEqual([
      "Voir M. Dupont demain.",
      "Lire p. ex. le rapport.",
      "J. Martin a appelé.",
    ]);
  });

  it("ends a list item at its line", () => {
    const s = new SentenceStream();
    expect(s.push("- Premier point\n- Deux")).toEqual(["Premier point."]);
    expect(s.flush()).toEqual(["Deux."]);
  });

  it("cuts a sentence too long for the engine at a comma, losing nothing", () => {
    const long = Array.from({ length: 30 }, (_, i) => `élément numéro ${i}`).join(", ") + ".";
    const parts = sentencesOf(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= MAX_SPOKEN)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("returns nothing for text with nothing to say", () => {
    expect(sentencesOf("  \n --- \n ** ")).toEqual([]);
  });
});

describe("choosing a voice", () => {
  const v = (name: string, lang: string, localService: boolean): VoiceLike => ({ name, lang, localService, voiceURI: name });
  const voices = [
    v("Microsoft Hortense - French (France)", "fr-FR", true),
    v("Google français", "fr-FR", false),
    v("Microsoft Denise Online (Natural) - French (France)", "fr-FR", false),
    v("Amélie", "fr-CA", true),
    v("Samantha", "en-US", true),
    v("Daniel", "en_GB", true),
  ];

  it("keeps the text on the device unless online voices are allowed", () => {
    expect(rankVoices(voices, "fr", false).map((x) => x.name)).toEqual(["Microsoft Hortense - French (France)", "Amélie"]);
  });

  it("prefers natural voices, then the language's main region", () => {
    expect(rankVoices(voices, "fr", true).map((x) => x.name)).toEqual([
      "Microsoft Denise Online (Natural) - French (France)",
      "Google français",
      "Microsoft Hortense - French (France)",
      "Amélie",
    ]);
    expect(rankVoices(voices, "en", false).map((x) => x.name)).toEqual(["Samantha", "Daniel"]);
  });
});


describe("speaking one sentence at a time", () => {
  function rig() {
    const spoken: UtteranceLike[] = [];
    const log: string[] = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const q = new SpeechQueue(
      { speak: (u) => spoken.push(u), cancel: () => log.push("cancel") },
      (text) => ({ text, onstart: null, onend: null, onerror: null, onboundary: null }),
      {
        onSpeaking: (b) => log.push(b ? "speaking" : "silent"),
        onSentence: (t, i) => log.push(`start ${i}: ${t}`),
        onDone: () => log.push("done"),
      },
      { set: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; }, clear: (id) => timers.delete(id as number) }
    );
    const finish = (u: UtteranceLike) => { u.onstart?.(); u.onend?.(); };
    return { q, spoken, log, timers, finish };
  }

  it("speaks as sentences stream in, in order, then says it is done", () => {
    const { q, spoken, log, finish } = rig();
    q.begin();
    q.push(["Un."]);
    expect(spoken.map((u) => u.text)).toEqual(["Un."]);
    q.push(["Deux.", "Trois."]);
    expect(spoken).toHaveLength(1); // one at a time
    finish(spoken[0]);
    expect(spoken.map((u) => u.text)).toEqual(["Un.", "Deux."]);
    finish(spoken[1]);
    finish(spoken[2]);
    expect(log).not.toContain("done"); // the stream is still open
    q.end();
    expect(log.at(-1)).toBe("done");
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start 0: Un.", "start 1: Deux.", "start 2: Trois."]);
  });

  it("waits for more when it has said everything but the answer is still coming", () => {
    const { q, spoken, finish, log } = rig();
    q.begin();
    q.push(["Un."]);
    finish(spoken[0]);
    q.push(["Deux."]);
    expect(spoken.map((u) => u.text)).toEqual(["Un.", "Deux."]);
    finish(spoken[1]);
    q.end();
    expect(log.at(-1)).toBe("done");
  });

  it("stops at once, and ignores what the engine reports about the silenced sentence", () => {
    const { q, spoken, log } = rig();
    q.say(["Un.", "Deux."]);
    q.stop();
    expect(log).toContain("cancel");
    spoken[0].onend?.(); // late event from the cancelled utterance
    expect(spoken).toHaveLength(1);
    expect(log).not.toContain("done");
    expect(q.busy).toBe(false);
  });

  it("moves on if the engine never says a sentence ended", () => {
    const { q, spoken, timers } = rig();
    q.say(["Un.", "Deux."]);
    expect(timers.size).toBe(1);
    [...timers.values()][0](); // the watchdog fires
    expect(spoken.map((u) => u.text)).toEqual(["Un.", "Deux."]);
  });

  it("treats an engine error as the end of that sentence, not of the whole answer", () => {
    const { q, spoken, log } = rig();
    q.say(["Un.", "Deux."]);
    spoken[0].onerror?.({ error: "synthesis-failed" });
    expect(spoken.map((u) => u.text)).toEqual(["Un.", "Deux."]);
    spoken[1].onerror?.({ error: "interrupted" });
    expect(log).not.toContain("done");
  });

  it("gives a slow voice time before the watchdog", () => {
    expect(watchdogMs("x".repeat(200), 0.5)).toBeGreaterThan(watchdogMs("x".repeat(200), 1));
    expect(watchdogMs("", 1)).toBe(4_000);
  });
});
