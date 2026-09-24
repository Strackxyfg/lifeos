/**
 * Speaking a sequence of sentences, one utterance at a time.
 *
 * The browser has a queue of its own; it is not used, for three reasons seen
 * in Chrome: an utterance waiting in it can be garbage-collected before it is
 * spoken, its `end` event is sometimes never fired (for network voices,
 * after a few minutes), and one long utterance is cut off after about fifteen
 * seconds. So sentences are spoken one by one, each kept referenced until it
 * ends, with a watchdog that moves on if `end` never comes.
 *
 * Streaming: `begin`, then `push` sentences as an answer arrives, then `end`.
 * Speaking starts with the first sentence. `stop` silences everything and
 * ignores whatever the engine reports afterwards about what it was saying.
 */

export interface UtteranceLike {
  text: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onboundary: (() => void) | null;
}

export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
}

export interface QueueEvents {
  onSpeaking: (speaking: boolean) => void;
  /** Each sentence as it starts, with its position in this sequence. */
  onSentence?: (text: string, index: number) => void;
  /** A word boundary — for visuals that follow the voice. */
  onBoundary?: () => void;
  /** Everything was said (not called after `stop`). */
  onDone?: () => void;
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

/** Longest a sentence may take before the watchdog assumes `end` was lost: generous, so it never cuts a slow voice. */
export function watchdogMs(text: string, rate: number): number {
  return Math.round((text.length * 110) / Math.max(0.5, rate)) + 4_000;
}

export class SpeechQueue {
  private pending: string[] = [];
  private current: UtteranceLike | null = null;
  private open = false;
  private generation = 0;
  private spoken = 0;
  private watchdog: unknown = null;

  constructor(
    private readonly synth: SynthLike,
    private readonly make: (text: string) => UtteranceLike,
    private readonly events: QueueEvents,
    private readonly timers: Timers,
    private readonly rate: () => number = () => 1
  ) {}

  get busy(): boolean {
    return this.current !== null || this.pending.length > 0 || this.open;
  }

  begin(): void {
    this.stop();
    this.open = true;
    this.spoken = 0;
  }

  push(sentences: string[]): void {
    const clean = sentences.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) return;
    this.pending.push(...clean);
    this.pump();
  }

  end(): void {
    this.open = false;
    if (!this.current && this.pending.length === 0) this.finish();
  }

  /** A whole text at once. */
  say(sentences: string[]): void {
    this.begin();
    this.push(sentences);
    this.end();
  }

  stop(): void {
    const wasBusy = this.busy;
    this.generation += 1;
    this.pending = [];
    this.open = false;
    this.clearWatchdog();
    if (this.current) {
      this.current = null;
      this.synth.cancel();
    }
    if (wasBusy) this.events.onSpeaking(false);
  }

  private pump(): void {
    if (this.current || this.pending.length === 0) return;
    const text = this.pending.shift()!;
    const generation = this.generation;
    const index = this.spoken++;
    const u = this.make(text);
    const next = () => {
      if (generation !== this.generation || this.current !== u) return;
      this.clearWatchdog();
      this.current = null;
      if (this.pending.length > 0) this.pump();
      else if (!this.open) this.finish();
    };
    u.onstart = () => {
      if (generation === this.generation) this.events.onSentence?.(text, index);
    };
    u.onend = next;
    // "interrupted" and "canceled" follow a stop, already handled.
    u.onerror = (e) => {
      if (e?.error === "interrupted" || e?.error === "canceled") return;
      next();
    };
    u.onboundary = () => {
      if (generation === this.generation) this.events.onBoundary?.();
    };
    this.current = u;
    this.events.onSpeaking(true);
    this.watchdog = this.timers.set(next, watchdogMs(text, this.rate()));
    this.synth.speak(u);
  }

  private finish(): void {
    this.events.onSpeaking(false);
    this.events.onDone?.();
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) this.timers.clear(this.watchdog);
    this.watchdog = null;
  }
}
