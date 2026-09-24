import { requireUserKey } from "@/lib/auth/require-user";
import { getStore } from "@/lib/db/store";
import { parseRange } from "@/lib/voice/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/**
 * A recording, to its owner only.
 *
 * `?meta=1` answers with its duration and its transcript word by word — what
 * the player lights as it plays. Otherwise the audio itself, with byte ranges
 * so the player can seek. Never cached: a second brain's voice has no
 * business in a shared machine's disk cache.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) return new Response(null, { status: 404 });

  const store = getStore();
  if (!(await store.supportsVoice())) return new Response(null, { status: 404 });
  const row = await store.get(auth.userKey, "audio", id);
  if (!row) return new Response(null, { status: 404 });

  if (new URL(req.url).searchParams.get("meta") === "1") {
    return Response.json({ durationMs: row.durationMs, mime: row.mime, words: row.transcript }, { headers: PRIVATE });
  }

  const bytes = await store.getAudio(auth.userKey, row.path);
  if (!bytes) return new Response(null, { status: 404 });
  const size = bytes.length;
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...PRIVATE, "Content-Range": `bytes */${size}` } });
  }
  const headers = { ...PRIVATE, "Content-Type": row.mime, "Accept-Ranges": "bytes", "Content-Disposition": "inline" };
  if (!range) {
    return new Response(new Blob([bytes as BlobPart]), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  }
  const part = bytes.subarray(range.start, range.end + 1);
  return new Response(new Blob([part as BlobPart]), {
    status: 206,
    headers: { ...headers, "Content-Length": String(part.length), "Content-Range": `bytes ${range.start}-${range.end}/${size}` },
  });
}
