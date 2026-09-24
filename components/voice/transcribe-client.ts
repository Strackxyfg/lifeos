import { extensionFor } from "@/components/brain/use-recorder";

export type TranscribeError = "denied" | "unsupported" | "too_large" | "empty" | "rate_limit" | "unavailable" | "failed";

const KNOWN: readonly TranscribeError[] = ["denied", "unsupported", "too_large", "empty", "rate_limit", "unavailable", "failed"];

/**
 * A recording sent to `/api/brain/transcribe`. Never throws: a network
 * failure is `failed`, and an error the server names is passed on as a code
 * the UI translates.
 */
export async function transcribeAudio(audio: Blob, locale: string): Promise<{ text: string } | { error: TranscribeError }> {
  const form = new FormData();
  form.append("audio", new File([audio], `memo.${extensionFor(audio.type)}`, { type: audio.type }));
  form.append("locale", locale);
  try {
    const res = await fetch("/api/brain/transcribe", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (res.ok && data.text) return { text: data.text };
    const code = KNOWN.find((k) => k === data.error);
    return { error: code ?? "failed" };
  } catch {
    return { error: "failed" };
  }
}
