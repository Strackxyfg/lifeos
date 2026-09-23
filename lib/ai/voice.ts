import "server-only";
import { AIError, breakerFor, clientFor, toRouteError, type RouteError } from "./router";
import { stripHallucinations } from "./transcript";

/**
 * Speech to text, for voice brain dumps.
 *
 * The browser's own dictation (Web Speech) is kept for short captures, but it
 * does not exist in Firefox, stops after a pause in Chrome, and cannot take a
 * two-minute memo. This records the memo and has it transcribed by Whisper on
 * Groq — large-v3-turbo first, large-v3 if its quota is spent — with the same
 * rests as the chat router: a route that said "too many requests" is left
 * alone until the time it gave.
 *
 * The audio goes to Groq, in the United States, for transcription; the screen
 * says so before recording. Nothing is kept once the text is back.
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

export async function transcribe(file: File, language?: "fr" | "en"): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new AIError("unavailable", "No transcription provider is configured.");
  const client = clientFor({ baseURL: "https://api.groq.com/openai/v1", apiKey });

  const failures: RouteError[] = [];
  for (const model of MODELS) {
    if ((restUntil.get(model) ?? 0) > Date.now()) continue;
    try {
      const r = await client.audio.transcriptions.create(
        { file, model, language, response_format: "json", temperature: 0 },
        { timeout: 60_000 }
      );
      return stripHallucinations(r.text ?? "");
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
