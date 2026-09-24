import "server-only";
import { randomUUID } from "node:crypto";
import type { Store } from "@/lib/db/types";
import { baseMime, extensionForMime } from "@/lib/db/audio-files";
import type { AudioWord } from "@/lib/voice/align";
import { tokens } from "./text";

/**
 * Keeping and letting go of recordings.
 *
 * A recording is a file in the person's own storage plus a row with its
 * transcript. The two are written together: if the row cannot be written,
 * the file is removed, so storage never holds audio nothing points to. A
 * recording is let go when the last note said in it is deleted.
 */

export interface Transcribed {
  words: AudioWord[];
  durationMs: number;
  language: string | null;
}

/** The recording's id, or null when recordings cannot be kept (migration 010 pending). */
export async function keepRecording(store: Store, userKey: string, audio: File, t: Transcribed): Promise<string | null> {
  if (!(await store.supportsVoice())) return null;
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const file = `${randomUUID()}.${extensionForMime(audio.type)}`;
  const path = await store.putAudio(userKey, file, bytes, audio.type);
  try {
    const row = await store.insert(userKey, "audio", {
      path,
      mime: baseMime(audio.type),
      bytes: bytes.length,
      durationMs: Math.max(0, Math.round(t.durationMs)),
      language: t.language,
      transcript: t.words,
    });
    return row.id;
  } catch (err) {
    await store.removeAudio(userKey, [path]).catch(() => {});
    throw err;
  }
}

/** Deletes a recording once no note points to it any more. */
export async function releaseRecording(store: Store, userKey: string, audioId: string): Promise<boolean> {
  const notes = await store.list(userKey, "brain");
  if (notes.some((n) => n.audioId === audioId)) return false;
  const row = await store.get(userKey, "audio", audioId);
  if (!row) return false;
  await store.remove(userKey, "audio", audioId);
  await store.removeAudio(userKey, [row.path]);
  return true;
}

/**
 * A note's title from what was said: its first sentence that says something,
 * kept short — "Bon, alors, plusieurs choses." opens many memos and names
 * none. The whole transcript is the detail, so nothing is lost.
 */
export function titleFromSpeech(text: string, max = 140): { title: string; detail: string | null } {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?\u2026]+[.!?\u2026]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [clean];
  const first = sentences.find((x) => tokens(x).length >= 2) ?? sentences[0] ?? clean;
  const title = first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}\u2026`;
  return { title, detail: title === clean ? null : clean };
}
