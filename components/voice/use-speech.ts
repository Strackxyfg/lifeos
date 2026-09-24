"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_VOICE_PREFS,
  getSpeechState,
  getVoicePrefs,
  speechSupported,
  subscribeSpeech,
  type SpeechState,
  type VoicePrefs,
} from "@/lib/voice/speaker";

const SERVER_STATE: SpeechState = { speaking: false, owner: null, sentence: -1 };

/** What the app's voice is doing. */
export function useSpeech(): SpeechState & { supported: boolean } {
  const s = useSyncExternalStore(subscribeSpeech, getSpeechState, () => SERVER_STATE);
  // Known after mount only: the server cannot tell whether the browser speaks.
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(speechSupported()), []);
  return { ...s, supported };
}

export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(subscribeSpeech, getVoicePrefs, () => DEFAULT_VOICE_PREFS);
}

/** The device's voices; they load asynchronously in Chrome. */
export function useDeviceVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSupported()) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}
