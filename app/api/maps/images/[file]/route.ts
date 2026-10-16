import { requireUserKey } from "@/lib/auth/require-user";
import { getMapStore } from "@/lib/maps/store";
import { IMAGE_FILE } from "@/lib/maps/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", gif: "image/gif" };

/**
 * An image placed on an idea — only ever the caller's own (their folder),
 * by a name that can only be "<id>.<image extension>". Never changes once
 * stored (a new image is a new file), so the browser may keep it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;
  const { file } = await params;
  if (!IMAGE_FILE.test(file)) return new Response("Not found", { status: 404 });
  const bytes = await getMapStore().getImage(auth.userKey, file);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": TYPES[file.split(".").pop()!] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
