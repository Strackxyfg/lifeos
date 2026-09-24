import { SentenceStream, rankVoices, sentencesOf, type VoiceLike } from "./speech";
import { SpeechQueue, type UtteranceLike } from "./queue";

/**
 * The one voice of the app, in the browser.
 *
 * A single queue for every "listen" button and for the conversation mode:
 * two components with a queue each would cancel each other's speech. State is
 * a small store (`subscribe` / `getSpeechState`) that `useSpeech` reads.
 *
 * Preferences — which voice, how fast, whether online voices are allowed,
 * whether answers are read out on their own — belong to the device, not the
 * account: the voices themselves are the device's. They live in local storage.
 */

export interface VoicePrefs {
  /** A chosen voice, by URI; null picks the best allowed one. */
  voiceURI: string | null;
  rate: number;
  /** Voices that send the text to Google (Chrome) or Microsoft (Edge) to be read. */
  allowOnline: boolean;
  /** Read answers aloud as they arrive. */
  autoRead: boolean;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = { voiceURI: null, rate: 1, allowOnline: false, autoRead: false };
const PREFS_KEY = "lifeos:voice";

export interface SpeechState {
  speaking: boolean;
  /** Who asked for the current speech — a button id, "conversation"… */
  owner: string | null;
  /** Index of the sentence being spoken in the current speech. */
  sentence: number;
}

let prefs: VoicePrefs | null = null;
let state: SpeechState = { speaking: false, owner: null, sentence: -1 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * A beat on every spoken word, read each frame by the 3D brain so it breathes
 * with the voice — a plain object, so following the voice re-renders nothing.
 */
export const voicePulse = { at: 0, speaking: false };

export function subscribeSpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSpeechState = (): SpeechState => state;

export function getVoicePrefs(): VoicePrefs {
  if (prefs) return prefs;
  prefs = { ...DEFAULT_VOICE_PREFS };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<VoicePrefs> | null;
    if (raw && typeof raw === "object") {
      prefs = {
        voiceURI: typeof raw.voiceURI === "string" ? raw.voiceURI : null,
        rate: typeof raw.rate === "number" && raw.rate >= 0.6 && raw.rate <= 1.6 ? raw.rate : 1,
        allowOnline: raw.allowOnline === true,
        autoRead: raw.autoRead === true,
      };
    }
  } catch {
    // Private browsing without storage: defaults.
  }
  return prefs;
}

export function setVoicePrefs(patch: Partial<VoicePrefs>): void {
  prefs = { ...getVoicePrefs(), ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Kept for this page only.
  }
  emit();
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** The voice that will read, for a language, given the preferences. */
export function chooseVoice(lang: "fr" | "en", p: VoicePrefs = getVoicePrefs()): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const all = window.speechSynthesis.getVoices();
  const chosen = p.voiceURI ? all.find((v) => v.voiceURI === p.voiceURI && v.lang.toLowerCase().startsWith(lang)) : undefined;
  if (chosen && (p.allowOnline || chosen.localService)) return chosen;
  const best = rankVoices(all as unknown as VoiceLike[], lang, p.allowOnline)[0];
  return (best as unknown as SpeechSynthesisVoice) ?? null;
}

let queue: SpeechQueue | null = null;
let lang: "fr" | "en" = "fr";
let onDone: (() => void) | null = null;
/**
 * Bumped by every new speech and every stop. A stream handle remembers its
 * session and goes quiet once it is over: an answer still arriving must not
 * keep feeding the queue after "listen" was pressed on something else.
 */
let session = 0;

function set(patch: Partial<SpeechState>) {
  state = { ...state, ...patch };
  emit();
}

function ensureQueue(): SpeechQueue {
  if (queue) return queue;
  const synth = window.speechSynthesis;
  queue = new SpeechQueue(
    { speak: (u) => synth.speak(u as unknown as SpeechSynthesisUtterance), cancel: () => synth.cancel() },
    (text) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = chooseVoice(lang);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = lang === "fr" ? "fr-FR" : "en-US";
      }
      u.rate = getVoicePrefs().rate;
      return u as unknown as UtteranceLike;
    },
    {
      onSpeaking: (speaking) => {
        voicePulse.speaking = speaking;
        set(speaking ? { speaking } : { speaking, owner: null, sentence: -1 });
      },
      onSentence: (_, index) => {
        voicePulse.at = performance.now();
        set({ sentence: index });
      },
      onBoundary: () => {
        voicePulse.at = performance.now();
      },
      onDone: () => {
        const done = onDone;
        onDone = null;
        done?.();
      },
    },
    { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
    () => getVoicePrefs().rate
  );
  // Chrome pauses speech in a background tab and does not always resume it.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && synth.paused) synth.resume();
  });
  return queue;
}

/**
 * Safari and iOS only let a page speak after a user gesture: call this in
 * the click that starts anything that will speak later (a conversation).
 */
export function unlockSpeech(): void {
  if (!speechSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // Nothing to unlock.
  }
}

/** Reads a finished text aloud. */
export function speakText(owner: string, text: string, language: "fr" | "en", done?: () => void): void {
  if (!speechSupported()) return;
  const q = ensureQueue();
  q.stop();
  session += 1;
  lang = language;
  onDone = done ?? null;
  set({ owner, sentence: -1 });
  q.say(sentencesOf(text));
}

/** Reads a text as it streams in: speaking starts with its first sentence. */
export function streamSpeech(owner: string, language: "fr" | "en", done?: () => void): { push: (chunk: string) => void; end: () => void } {
  if (!speechSupported()) return { push: () => {}, end: () => done?.() };
  const q = ensureQueue();
  q.stop();
  const mine = ++session;
  lang = language;
  onDone = done ?? null;
  set({ owner, sentence: -1 });
  q.begin();
  const sentences = new SentenceStream();
  return {
    push: (chunk) => {
      if (mine === session) q.push(sentences.push(chunk));
    },
    end: () => {
      if (mine !== session) return;
      q.push(sentences.flush());
      q.end();
    },
  };
}

export function stopSpeaking(): void {
  session += 1;
  onDone = null;
  queue?.stop();
}
