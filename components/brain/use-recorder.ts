"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Records a voice memo in the browser, for transcription on the server.
 *
 * Unlike dictation (`use-dictation.ts`), this works in every current browser,
 * including Firefox, and does not stop at the first pause: it is meant for a
 * few minutes of thinking out loud. Opus at 32 kb/s keeps five minutes near
 * 1.2 MB, far under the upload limit.
 */

export type RecorderError = "denied" | "unsupported" | "failed";

export const MAX_RECORDING_MS = 5 * 60_000;

/** Tried in order; Safari only records MP4. */
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** The file extension the transcription service reads the format from. */
export function extensionFor(type: string): string {
  const base = type.split(";")[0].trim();
  if (base.endsWith("webm")) return "webm";
  if (base.endsWith("ogg")) return "ogg";
  if (base.endsWith("mp4") || base.endsWith("m4a")) return "mp4";
  if (base.endsWith("mpeg")) return "mp3";
  if (base.endsWith("wav") || base.endsWith("wave")) return "wav";
  return "webm";
}

export function useRecorder({
  onRecorded,
  onError,
}: {
  onRecorded: (audio: Blob) => void;
  onError: (e: RecorderError) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /** Loudness, 0 to 1, for the meter. */
  const [level, setLevel] = useState(0);

  const rec = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    audio: AudioContext | null;
    frame: number;
    timer: number;
    discard: boolean;
  } | null>(null);
  // The latest callbacks, so a recording started before a re-render reports
  // to the current ones.
  const cb = useRef({ onRecorded, onError });
  cb.current = { onRecorded, onError };

  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const release = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.frame);
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.audio?.close().catch(() => {});
    rec.current = null;
    setRecording(false);
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    const r = rec.current;
    if (r && r.recorder.state !== "inactive") r.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (rec.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      return cb.current.onError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported");
    }

    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return cb.current.onError("unsupported");
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      if (rec.current) rec.current.discard = true;
      cb.current.onError("failed");
    };
    recorder.onstop = () => {
      const discard = rec.current?.discard ?? true;
      release();
      if (discard) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (blob.size > 0) cb.current.onRecorded(blob);
      else cb.current.onError("failed");
    };

    // The meter. Optional: a browser without Web Audio still records.
    let audio: AudioContext | null = null;
    let frame = 0;
    try {
      audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        if (t - last > 80) {
          last = t;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          // Speech sits around 0.05–0.2 RMS; scale it into the meter's range.
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        }
        if (rec.current) rec.current.frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch {
      audio = null;
    }

    const began = Date.now();
    const timer = window.setInterval(() => {
      const ms = Date.now() - began;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) stop();
    }, 250);

    rec.current = { recorder, stream, audio, frame, timer, discard: false };
    setElapsed(0);
    setRecording(true);
    // Chunks every second: a crash mid-memo still leaves most of it.
    recorder.start(1000);
  }, [release, stop]);

  // Leaving the page drops the recording and frees the microphone.
  useEffect(
    () => () => {
      if (rec.current) {
        rec.current.discard = true;
        if (rec.current.recorder.state !== "inactive") rec.current.recorder.stop();
        release();
      }
    },
    [release]
  );

  return { supported, recording, elapsed, level, start, stop };
}
