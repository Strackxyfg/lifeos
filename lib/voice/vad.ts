/**
 * When someone has finished speaking — from the microphone's loudness alone.
 *
 * A conversation with the brain is hands-free: nobody should have to press
 * "stop" after a question. The recorder reports a loudness (0–1) about twelve
 * times a second; this decides, sample by sample, whether speech has started,
 * whether it has ended, or whether nobody is going to speak.
 *
 * The threshold adapts to the room: the noise floor is learnt while waiting,
 * and speech must stand clearly above it for a moment (a keyboard click or a
 * cough does not start a question). Speech ends after a silence held long
 * enough to be a full stop, not a breath between two words. Pure: a state and
 * a step function, so it is tested without a microphone.
 */

export interface VadConfig {
  /** Listening to the room before anything counts as speech. */
  calibrateMs: number;
  /** Loudness that always counts as speech, whatever the room. */
  minLevel: number;
  /**
   * No room is louder than this with nobody speaking. Caps what calibration
   * learns, so a person who starts talking at once is not taken for the room.
   */
  maxNoise: number;
  /** How far above the noise floor speech must be, as a multiple. */
  factor: number;
  /** Speech must last this long to count as started. */
  startMs: number;
  /** A silence this long after speech ends it. */
  endSilenceMs: number;
  /** Nobody spoke for this long: give up. */
  maxWaitMs: number;
  /** A single question is never longer than this. */
  maxSpeechMs: number;
}

export const CONVERSATION_VAD: VadConfig = {
  calibrateMs: 320,
  minLevel: 0.06,
  maxNoise: 0.1,
  factor: 2.2,
  startMs: 180,
  endSilenceMs: 1_300,
  maxWaitMs: 9_000,
  maxSpeechMs: 45_000,
};

export type VadPhase = "waiting" | "speaking" | "done" | "timeout";

export interface VadState {
  phase: VadPhase;
  /** Estimated loudness of the room with nobody speaking; -1 before the first sample. */
  noise: number;
  calibratedMs: number;
  /** Consecutive loud time while waiting. */
  loudMs: number;
  /** Consecutive quiet time while speaking. */
  quietMs: number;
  waitedMs: number;
  spokenMs: number;
}

export function initialVad(): VadState {
  return { phase: "waiting", noise: -1, calibratedMs: 0, loudMs: 0, quietMs: 0, waitedMs: 0, spokenMs: 0 };
}

export function threshold(noise: number, cfg: VadConfig): number {
  return Math.max(cfg.minLevel, (noise < 0 ? 0 : noise) * cfg.factor + 0.015);
}

export function vadStep(s: VadState, level: number, dtMs: number, cfg: VadConfig = CONVERSATION_VAD): VadState {
  if (s.phase === "done" || s.phase === "timeout") return s;
  const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));

  // The first moments only calibrate. The quietest sample is kept: even if the
  // person starts at once, speech has gaps, and a hum does not.
  if (s.phase === "waiting" && s.calibratedMs < cfg.calibrateMs) {
    const waitedMs = s.waitedMs + dtMs;
    const heard = Math.min(l, cfg.maxNoise);
    // Loud enough to be speech in the loudest room still counts: a quick "yes" said at once is not lost.
    const loudMs = l > threshold(cfg.maxNoise, cfg) ? s.loudMs + dtMs : 0;
    return { ...s, noise: s.noise < 0 ? heard : Math.min(s.noise, heard), calibratedMs: s.calibratedMs + dtMs, waitedMs, loudMs };
  }

  const loud = l > threshold(s.noise, cfg);

  if (s.phase === "waiting") {
    // Learn the room from quiet samples only, so the start of speech does not raise the floor.
    const noise = loud ? s.noise : Math.min(cfg.maxNoise, s.noise < 0 ? l : s.noise * 0.92 + l * 0.08);
    const loudMs = loud ? s.loudMs + dtMs : 0;
    const waitedMs = s.waitedMs + dtMs;
    if (loudMs >= cfg.startMs) return { ...s, phase: "speaking", noise, loudMs, quietMs: 0, waitedMs, spokenMs: loudMs };
    if (waitedMs >= cfg.maxWaitMs) return { ...s, phase: "timeout", noise, loudMs, waitedMs };
    return { ...s, noise, loudMs, waitedMs };
  }

  const spokenMs = s.spokenMs + dtMs;
  const quietMs = loud ? 0 : s.quietMs + dtMs;
  if (quietMs >= cfg.endSilenceMs || spokenMs >= cfg.maxSpeechMs) return { ...s, phase: "done", quietMs, spokenMs };
  return { ...s, quietMs, spokenMs };
}
