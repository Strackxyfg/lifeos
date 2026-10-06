import { NextResponse } from "next/server";
import { isRunnerFile, manifest, prepare, publicOrigin, readRunnerFile, sha256 } from "@/lib/agent/runner-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agent runner's installer and files, for a server to fetch:
 *
 *   curl -fsSL https://<this LifeOS>/api/agent/runner/install.sh | sudo bash
 *
 * Public by design (see `lib/agent/runner-files.ts`): source code and an
 * installer, no secret, no data. The installer then fetches the other files
 * from here and checks each against `manifest.json`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const headers = { "Cache-Control": "no-store" };

  if (file === "manifest.json") {
    return NextResponse.json(await manifest(), { headers });
  }
  if (!isRunnerFile(file)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }

  const lang = new URL(req.url).searchParams.get("lang");
  const body = prepare(file, await readRunnerFile(file), publicOrigin(req), lang);
  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": file === "install.sh" ? "text/x-shellscript; charset=utf-8" : "text/plain; charset=utf-8",
      "X-Content-SHA256": sha256(body),
    },
  });
}
