import { describe, it, expect } from "vitest";
import { CONVERSATION_VAD, initialVad, threshold, vadStep, type VadState } from "@/lib/voice/vad";

const DT = 80; // the recorder's meter ticks about every 80 ms

/** Feeds levels (one per tick) and returns every state. */
function run(levels: number[], from: VadState = initialVad()) {
  const states: VadState[] = [];
  let s = from;
  for (const l of levels) {
    s = vadStep(s, l, DT);
    states.push(s);
  }
  return states;
}
const ticks = (ms: number, level: number) => Array.from({ length: Math.ceil(ms / DT) }, () => level);

describe("hearing the end of a question", () => {
  it("waits in a quiet room, starts with speech, ends after a held silence", () => {
    const states = run([...ticks(800, 0.01), ...ticks(2_000, 0.3), ...ticks(1_400, 0.01)]);
    const phases = states.map((s) => s.phase);
    expect(phases.indexOf("speaking")).toBeGreaterThan(9);
    expect(phases.at(-1)).toBe("done");
  });

  it("does not end on a breath between two words", () => {
    const states = run([...ticks(500, 0.01), ...ticks(1_000, 0.3), ...ticks(600, 0.01), ...ticks(1_000, 0.3)]);
    expect(states.at(-1)?.phase).toBe("speaking");
  });

  it("ignores a click: loud, but too short to be speech", () => {
    const states = run([...ticks(500, 0.01), 0.5, 0.01, 0.6, ...ticks(1_000, 0.01)]);
    expect(states.every((s) => s.phase === "waiting")).toBe(true);
  });

  it("adapts to a noisy room: its hum is not speech", () => {
    const hum = ticks(3_000, 0.09 + 0.005);
    const states = run(hum);
    expect(states.at(-1)?.phase).toBe("waiting");
    expect(threshold(states.at(-1)!.noise, CONVERSATION_VAD)).toBeGreaterThan(0.18);
    // A voice clearly above the hum still starts the question.
    expect(run(ticks(400, 0.45), states.at(-1)!).at(-1)?.phase).toBe("speaking");
  });

  it("gives up when nobody speaks", () => {
    expect(run(ticks(CONVERSATION_VAD.maxWaitMs + 200, 0.01)).at(-1)?.phase).toBe("timeout");
  });

  it("never lets a question run forever", () => {
    expect(run([...ticks(300, 0.3), ...ticks(CONVERSATION_VAD.maxSpeechMs + 500, 0.3)]).at(-1)?.phase).toBe("done");
  });

  it("stays finished, and survives garbage levels", () => {
    const done = run([...ticks(400, 0.3), ...ticks(1_500, 0)]).at(-1)!;
    expect(done.phase).toBe("done");
    expect(vadStep(done, 0.9, DT)).toBe(done);
    expect(() => run([Number.NaN, Infinity, -1, 2])).not.toThrow();
  });
});

describe("the first moments", () => {
  it("hears a person who starts speaking at once", () => {
    const states = run([...ticks(1_500, 0.3), ...ticks(1_500, 0.01)]);
    expect(states.map((s) => s.phase)).toContain("speaking");
    expect(states.at(-1)?.phase).toBe("done");
  });
});
