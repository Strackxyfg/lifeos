import { requireUserKey } from "@/lib/auth/require-user";
import { AIError } from "@/lib/ai/router";
import { quota } from "@/lib/ai/quota";
import { MAX_AUDIO_BYTES, acceptsAudio, transcribe, voiceAvailable } from "@/lib/ai/voice";
import { isLocale } from "@/lib/i18n/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Whisper takes a few seconds per minute of audio; a long memo needs headroom.
export const maxDuration = 60;

/**
 * A voice memo in, its transcript out. The audio is not stored: it is passed
 * to the transcription provider and dropped with the request.
 *
 * Errors are codes the client translates: `unauthorized`, `unavailable` (no
 * provider configured), `too_large`, `unsupported`, `empty`, `rate_limit`
 * (with `retryAfter` in seconds when it is the person's own allowance),
 * `failed`.
 */
export async function POST(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;
  if (!voiceAvailable()) return Response.json({ error: "unavailable" }, { status: 503 });

  // Refuse an oversized body before reading it, when the client says its size.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) return Response.json({ error: "too_large" }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "unsupported" }, { status: 400 });
  if (audio.size === 0) return Response.json({ error: "empty" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  if (!acceptsAudio(audio.type)) return Response.json({ error: "unsupported" }, { status: 415 });

  const allowed = quota().take(auth.userKey, "transcribe");
  if (!allowed.ok) {
    return Response.json(
      { error: "rate_limit", retryAfter: Math.ceil(allowed.retryAfterMs / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(allowed.retryAfterMs / 1000)) } }
    );
  }

  const localeRaw = form?.get("locale");
  const language = typeof localeRaw === "string" && isLocale(localeRaw) ? localeRaw : undefined;

  try {
    const text = await transcribe(audio, language);
    if (!text) return Response.json({ error: "empty" }, { status: 422 });
    return Response.json({ text });
  } catch (err) {
    if (err instanceof AIError) {
      const status = err.code === "rate_limit" ? 429 : err.code === "unavailable" ? 503 : 502;
      return Response.json({ error: err.code }, { status });
    }
    console.error("[transcribe] failed", err);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
