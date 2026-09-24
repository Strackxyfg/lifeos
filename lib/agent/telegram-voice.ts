import "server-only";
import { AIError } from "@/lib/ai/router";
import { quota } from "@/lib/ai/quota";
import { MAX_AUDIO_BYTES, acceptsAudio, transcribe, voiceAvailable } from "@/lib/ai/voice";
import { extensionForMime } from "@/lib/db/audio-files";

/**
 * A voice message sent to the LifeOS bot, as text for the agent.
 *
 * Talking is how people use Telegram on the move. A voice message is
 * transcribed and then goes down exactly the same road as a typed one — the
 * pending queue, the policy engine, the audit log — so saying something to
 * the agent grants it nothing that typing would not.
 *
 * Transcribed only once the chat is known to belong to someone (the webhook
 * checks that first): an unlinked chat never costs a transcription. Bounded
 * in length and size before anything is downloaded, and during the download
 * too, whatever Telegram declared.
 */

export interface TelegramVoice {
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

/** Five minutes: the same bound as a voice note recorded in the app. */
export const MAX_VOICE_SECONDS = 300;

export type VoiceFailure = "unavailable" | "too_long" | "too_large" | "unsupported" | "rate_limit" | "empty" | "failed";
export type VoiceOutcome = { ok: true; text: string } | { ok: false; reason: VoiceFailure };

export interface VoiceDeps {
  available: () => boolean;
  /** Takes one transcription from the person's allowance; false when it is spent. */
  allow: () => boolean;
  /** Where to download the file from, via the Bot API's getFile. */
  fileUrl: (fileId: string) => Promise<string | null>;
  /** The file's bytes, or null past `maxBytes` or on failure. */
  download: (url: string, maxBytes: number) => Promise<Uint8Array | null>;
  transcribe: (file: File) => Promise<string>;
}

export async function voiceToText(voice: TelegramVoice, deps: VoiceDeps): Promise<VoiceOutcome> {
  if (!deps.available()) return { ok: false, reason: "unavailable" };
  if ((voice.duration ?? 0) > MAX_VOICE_SECONDS) return { ok: false, reason: "too_long" };
  if ((voice.file_size ?? 0) > MAX_AUDIO_BYTES) return { ok: false, reason: "too_large" };
  // Telegram voice messages are Ogg Opus; an audio file says its own type.
  const mime = voice.mime_type ?? "audio/ogg";
  if (!acceptsAudio(mime)) return { ok: false, reason: "unsupported" };
  if (!deps.allow()) return { ok: false, reason: "rate_limit" };

  const url = await deps.fileUrl(voice.file_id).catch(() => null);
  if (!url) return { ok: false, reason: "failed" };
  const bytes = await deps.download(url, MAX_AUDIO_BYTES).catch(() => null);
  if (!bytes) return { ok: false, reason: "too_large" };

  try {
    const text = (await deps.transcribe(new File([bytes as BlobPart], `voice.${extensionForMime(mime)}`, { type: mime }))).trim();
    return text ? { ok: true, text } : { ok: false, reason: "empty" };
  } catch (err) {
    return { ok: false, reason: err instanceof AIError && err.code === "rate_limit" ? "rate_limit" : "failed" };
  }
}

/** What the bot answers when a voice message cannot be taken. */
export const VOICE_REPLIES: Record<VoiceFailure, string> = {
  unavailable: "🎤 Voice messages are not available on this workspace yet. Please type your message.",
  too_long: "🎤 That voice message is longer than 5 minutes. Please send a shorter one.",
  too_large: "🎤 That voice message is too large. Please send a shorter one.",
  unsupported: "🎤 I can't read that audio format. Please send a voice message or type your message.",
  rate_limit: "🎤 Too many voice messages for now. Try again in a little while, or type your message.",
  empty: "🎤 I couldn't hear anything in that voice message.",
  failed: "🎤 I couldn't transcribe that voice message. Please try again, or type your message.",
};

const API = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

/** The real dependencies, for one person. */
export function telegramVoiceDeps(userKey: string): VoiceDeps {
  return {
    available: voiceAvailable,
    allow: () => quota().take(userKey, "transcribe").ok,
    fileUrl: async (fileId) => {
      const res = await fetch(API("getFile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string } } | null;
      const path = data?.ok ? data.result?.file_path : undefined;
      return path ? `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}` : null;
    },
    download: async (url, maxBytes) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok || !res.body) return null;
      if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return null;
      // Counted as it arrives: a declared size is a claim, not a limit.
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          return null;
        }
        parts.push(value);
      }
      const out = new Uint8Array(total);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    },
    transcribe: (file) => transcribe(file),
  };
}
