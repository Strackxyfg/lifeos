import { classifyNote } from "@/lib/ai/classify";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireUserKey } from "@/lib/auth/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Picks the region for a captured thought. Classification only.
 *
 * It used to also return a sentence ("Filed under ideas.") that the client
 * saved as the note's detail — so every captured thought had machine
 * commentary appended to it, as if the person had written it. The person's
 * words are stored verbatim; this only decides where they go.
 */
export async function POST(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { text?: string; locale?: string };
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";
  return Response.json(await classifyNote(body.text ?? "", locale));
}
