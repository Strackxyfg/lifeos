import { extensionFor } from "@/components/brain/use-recorder";
import { toAudioWords, type AudioWord } from "@/lib/voice/align";

/** A recording as the server expects it: a named file whose extension says its format. */
export const audioFile = (audio: Blob) => new File([audio], `memo.${extensionFor(audio.type)}`, { type: audio.type });

export type TranscribeError = "denied" | "unsupported" | "too_large" | "empty" | "rate_limit" | "unavailable" | "failed";

const KNOWN: readonly TranscribeError[] = ["denied", "unsupported", "too_large", "empty", "rate_limit", "unavailable", "failed"];

/** Word timings, asked for when a recording will be kept. */
export interface Timed {
  words: AudioWord[];
  durationMs: number;
  language: string | null;
}

/**
 * A recording sent to `/api/brain/transcribe`. Never throws: a network
 * failure is `failed`, and an error the server names is passed on as a code
 * the UI translates.
 */
export async function transcribeAudio(
  audio: Blob,
  locale: string,
  opts: { detail?: boolean } = {}
): Promise<({ text: string } & Partial<Timed>) | { error: TranscribeError }> {
  const form = new FormData();
  form.append("audio", audioFile(audio));
  form.append("locale", locale);
  if (opts.detail) form.append("detail", "1");
  try {
    const res = await fetch("/api/brain/transcribe", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string; words?: unknown; durationMs?: number; language?: string | null };
    if (res.ok && data.text) {
      return opts.detail
        ? { text: data.text, words: toAudioWords(data.words), durationMs: data.durationMs ?? 0, language: data.language ?? null }
        : { text: data.text };
    }
    const code = KNOWN.find((k) => k === data.error);
    return { error: code ?? "failed" };
  } catch {
    return { error: "failed" };
  }
}
