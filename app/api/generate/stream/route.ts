import { NextResponse } from "next/server";
import { type GenStreamEvent } from "@/lib/notion/phases";
import { getNotionConnection } from "@/lib/notion/connection";
import { generateWorkspace } from "@/lib/notion/generate";
import { requireUserKey } from "@/lib/auth/require-user";
import { getProfile } from "@/lib/user/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Builds a Notion workspace from the person's profile, streaming real progress
 * as Server-Sent Events. This is the optional Notion export — the second brain
 * itself never needs it.
 *
 * What to build is read from the stored profile on the server, not from the
 * request: the client no longer gets to say what is written into Notion.
 *
 * Without a Notion connection it refuses (409). It used to stream a
 * "simulated" build that created nothing.
 */
export async function POST() {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;

  const connection = await getNotionConnection(auth.userKey).catch(() => null);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }

  const profile = await getProfile();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: GenStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client disconnected — the build carries on and completes in Notion */
        }
      };

      try {
        const manifest = await generateWorkspace({
          token: connection.token,
          rootPageId: connection.rootPageId,
          person: { name: profile.name === "there" ? null : profile.firstName, areas: profile.areas },
          onProgress: (e) => {
            if (e.step !== "done") send({ state: "active", step: e.step, progress: e.progress, db: e.db });
          },
        });
        send({ state: "done", databases: manifest.databases.length, workspaceUrl: manifest.databases[0]?.url });
      } catch (err) {
        console.error("[notion] build failed", err);
        send({
          state: "error",
          code: "failed",
          // Notion's own message is actionable ("Could not find page…") and
          // carries no secret; anything else stays generic.
          message: err instanceof Error ? err.message.slice(0, 300) : undefined,
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
