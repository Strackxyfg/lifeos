import { AIError, ai, aiAvailable } from "@/lib/ai/router";
import { quota } from "@/lib/ai/quota";
import { requireUserKey } from "@/lib/auth/require-user";
import { parseIdeas, suggestInput, suggestMessages } from "@/lib/maps/suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Ideas to grow one idea of a mind map (lib/maps/suggest.ts). Signed in only,
 * within a per-person allowance: it spends the operator's model budget.
 */
export async function POST(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;
  if (!aiAvailable()) return json({ ok: false, code: "unavailable" }, 503);

  const input = suggestInput(await req.json().catch(() => null));
  if (!input) return json({ ok: false, code: "invalid" }, 400);
  if (!quota().take(auth.userKey, "maps").ok) return json({ ok: false, code: "rate_limit" }, 429);

  try {
    const { value } = await ai().complete({
      task: "maps",
      temperature: 0.7,
      maxTokens: 300,
      json: true,
      // An answer with no usable idea goes to the next model.
      validate: (text) => (parseIdeas(text, input.siblings)?.length ?? 0) > 0,
      messages: suggestMessages(input),
    });
    return json({ ok: true, ideas: parseIdeas(value, input.siblings) ?? [] });
  } catch (e) {
    if (e instanceof AIError) {
      if (e.code === "unavailable") return json({ ok: false, code: "unavailable" }, 503);
      if (e.code === "rate_limit") return json({ ok: false, code: "rate_limit" }, 429);
    }
    console.error("[maps] suggest", e);
    return json({ ok: false, code: "failed" }, 502);
  }
}
