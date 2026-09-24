import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserKey } from "@/lib/auth/require-user";
import { AIError } from "@/lib/ai/router";
import { quota } from "@/lib/ai/quota";
import { classifyNote } from "@/lib/ai/classify";
import { MAX_AUDIO_BYTES, acceptsAudio, transcribeDetailed, voiceAvailable } from "@/lib/ai/voice";
import { getStore } from "@/lib/db/store";
import { kindForCategory } from "@/lib/data/brain";
import { toBrainNotes } from "@/lib/brain/load";
import { keepRecording, titleFromSpeech } from "@/lib/brain/recordings";
import { atomsSchema, saveAtoms } from "@/lib/brain/save-atoms";
import { toAudioWords } from "@/lib/voice/align";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A voice note: the recording, kept in the person's own storage, and what
 * was said in it, as notes.
 *
 * - `note` (default): one note. The recording is transcribed word by word
 *   here; the first sentence becomes the title, the whole transcript the
 *   detail, the region is classified, and the note plays the recording.
 * - `atoms`: a brain dump already transcribed and split, as the person kept
 *   it in the preview. Each new note plays the passage its quote was found
 *   in (`lib/voice/align.ts`).
 *
 * Before migration 010 the notes are saved and the recording is not; the
 * answer says so (`kept: false`) and the screen tells the person.
 */

const payloadSchema = z.union([
  z.object({ mode: z.literal("note") }),
  z.object({
    mode: z.literal("atoms"),
    notes: atomsSchema,
    words: z.array(z.unknown()).max(4_000),
    durationMs: z.number().int().min(0).max(3_600_000),
    language: z.string().max(16).nullable().optional(),
  }),
]);

export async function POST(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;
  const { userKey } = auth;

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 256 * 1024) return Response.json({ error: "too_large" }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "unsupported" }, { status: 400 });
  if (audio.size === 0) return Response.json({ error: "empty" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  if (!acceptsAudio(audio.type)) return Response.json({ error: "unsupported" }, { status: 415 });

  const localeRaw = form?.get("locale");
  const locale: Locale = typeof localeRaw === "string" && isLocale(localeRaw) ? localeRaw : "en";
  let payload: z.infer<typeof payloadSchema>;
  try {
    const raw = form?.get("payload");
    payload = payloadSchema.parse(typeof raw === "string" ? JSON.parse(raw) : { mode: "note" });
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const store = getStore();
  const m = dictionaries[locale];

  try {
    if (payload.mode === "atoms") {
      const words = toAudioWords(payload.words);
      const recording = await keepRecording(store, userKey, audio, {
        words,
        durationMs: payload.durationMs,
        language: payload.language ?? null,
      });
      const saved = await saveAtoms(store, userKey, payload.notes, m, recording ? { id: recording, words } : null);
      revalidatePath("/brain");
      return Response.json({ ...saved, kept: recording !== null });
    }

    // One note, transcribed here.
    if (!voiceAvailable()) return Response.json({ error: "unavailable" }, { status: 503 });
    const allowed = quota().take(userKey, "transcribe");
    if (!allowed.ok) {
      const retryAfter = Math.ceil(allowed.retryAfterMs / 1000);
      return Response.json({ error: "rate_limit", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    }
    const t = await transcribeDetailed(audio, locale);
    if (!t.text) return Response.json({ error: "empty" }, { status: 422 });

    const [recording, region] = await Promise.all([keepRecording(store, userKey, audio, t), classifyNote(t.text, locale)]);
    const { title, detail } = titleFromSpeech(t.text);
    const item = await store.insert(userKey, "brain", {
      title,
      detail,
      category: region.category,
      kind: kindForCategory[region.category],
      seedKey: null,
      done: false,
      ai: false,
      ...(recording ? { audioId: recording, audioStartMs: null, audioEndMs: null } : {}),
    });
    revalidatePath("/brain");
    return Response.json({ note: toBrainNotes([item], m)[0], kept: recording !== null });
  } catch (err) {
    if (err instanceof AIError) {
      const status = err.code === "rate_limit" ? 429 : err.code === "unavailable" ? 503 : 502;
      return Response.json({ error: err.code }, { status });
    }
    console.error("[voice-note] failed", err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
