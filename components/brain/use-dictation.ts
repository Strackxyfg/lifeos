"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";

/**
 * Dictation through the browser's own speech recognition.
 *
 * Replaces a microphone button that did nothing. Two rules follow from that:
 * the button only appears where dictation actually works (Chrome, Edge,
 * Safari — not Firefox), and the UI says where the audio goes. In Chrome that
 * is Google's speech service, in Safari Apple's; LifeOS never receives it.
 * For a product that calls itself sovereign, that must be disclosed, not
 * discovered.
 */

// The Web Speech API isn't in TypeScript's DOM lib; this is the slice we use.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationError = "denied" | "failed";

export function useDictation({
  locale,
  onText,
  onError,
}: {
  locale: Locale;
  /** Called with the running transcript; `final` once the utterance ends. */
  onText: (text: string, final: boolean) => void;
  onError: (e: DictationError) => void;
}) {
  // Decided after mount: the server can't know the browser, and guessing would
  // render a button that then vanishes (a hydration mismatch).
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  // Latest callbacks without re-creating the recogniser on every render.
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;

    const r = new Ctor();
    r.lang = locale === "fr" ? "fr-FR" : "en-US";
    r.continuous = false;
    r.interimResults = true;

    r.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) final = true;
      }
      cb.current.onText(text.trim(), final);
    };
    r.onerror = (e) => {
      // Silence is not an error; the user just didn't speak.
      if (e.error === "no-speech" || e.error === "aborted") return;
      cb.current.onError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : "failed");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };

    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
      cb.current.onError("failed");
    }
  }, [locale]);

  return { supported, listening, start, stop };
}
