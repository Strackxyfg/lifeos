import "server-only";
import { AIError, breakerFor, clientFor, toRouteError, type RouteError } from "./router";
import { stripHallucinations, stripWordHallucinations } from "./transcript";
import { toAudioWords, type AudioWord } from "@/lib/voice/align";

/**
 * Speech to text, for voice notes, brain dumps and conversations.
 *
 * The browser's own dictation (Web Speech) is kept for short captures, but it
 * does not exist in Firefox, stops after a pause in Chrome, and cannot take a
 * two-minute memo. This records the memo and has it transcribed by Whisper on
 * Groq — large-v3-turbo first, large-v3 if its quota is spent — with the same
 * rests as the chat router: a route that said "too many requests" is left
 * alone until the time it gave.
 *
 * The audio goes to Groq, in the United States, for transcription; the screen
 * says so before recording. Groq keeps nothing once the text is back; LifeOS
 * keeps a recording only as a voice note, in the person's own storage.
 */

const MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"] as const;
const restUntil = new Map<string, number>();

/** What the recorder may send: the formats browsers record and Whisper reads. */
export const AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/x-m4a",
  "audio/m4a",
] as const;

/**
 * 4 MB: under the 4.5 MB a serverless request body may carry on Vercel, and
 * about fifteen minutes of speech at the bitrates browsers record.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export function acceptsAudio(type: string): boolean {
  const base = type.split(";")[0].trim().toLowerCase();
  return (AUDIO_TYPES as readonly string[]).includes(base);
}

export function voiceAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** Tries each Whisper model in turn, skipping those resting after a refusal. */
async function withWhisper<T>(call: (model: string, client: ReturnType<typeof clientFor>) => Promise<T>): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new AIError("unavailable", "No transcription provider is configured.");
  const client = clientFor({ baseURL: "https://api.groq.com/openai/v1", apiKey });

  const failures: RouteError[] = [];
  for (const model of MODELS) {
    if ((restUntil.get(model) ?? 0) > Date.now()) continue;
    try {
      return await call(model, client);
    } catch (e) {
      const err = toRouteError(e);
      failures.push(err);
      const rest = breakerFor(err);
      if (rest) restUntil.set(model, Date.now() + rest.ms);
      // A file the provider refuses is refused by every model: stop here.
      if (err.status === 400 || err.status === 413 || err.status === 415) break;
    }
  }
  const limited = failures.length > 0 && failures.every((f) => f.status === 429);
  throw new AIError(limited || failures.length === 0 ? "rate_limit" : "failed", failures.at(-1)?.message ?? "Transcription is resting.");
}

export async function transcribe(file: File, language?: "fr" | "en"): Promise<string> {
  return withWhisper(async (model, client) => {
    const r = await client.audio.transcriptions.create(
      { file, model, language, response_format: "json", temperature: 0 },
      { timeout: 60_000 }
    );
    return stripHallucinations(r.text ?? "");
  });
}

export interface DetailedTranscript {
  text: string;
  /** Word by word, times in milliseconds — empty if the provider gave none. */
  words: AudioWord[];
  durationMs: number;
  language: string | null;
}

/**
 * The transcript with a time for every word: what lets a voice note light
 * each word as it is played, and a note split out of a memo find its passage.
 */
export async function transcribeDetailed(file: File, language?: "fr" | "en"): Promise<DetailedTranscript> {
  return withWhisper(async (model, client) => {
    const r = (await client.audio.transcriptions.create(
      {
        file,
        model,
        language,
        response_format: "verbose_json",
        timestamp_granularities: ["word", "segment"],
        temperature: 0,
      },
      { timeout: 90_000 }
    )) as unknown as { text?: string; words?: unknown; duration?: number; language?: string };
    const words = stripWordHallucinations(toAudioWords(r.words));
    // The text is the words themselves when there are any, so what is shown
    // and what is lit while playing can never disagree.
    const text = words.length > 0 ? words.map((w) => w.w).join(" ") : stripHallucinations(r.text ?? "");
    const durationMs = typeof r.duration === "number" && Number.isFinite(r.duration) ? Math.round(r.duration * 1000) : words.at(-1)?.e ?? 0;
    return { text: text.trim(), words, durationMs, language: typeof r.language === "string" ? r.language.slice(0, 16) : language ?? null };
  });
}
