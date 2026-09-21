import { getAI, systemPrompt } from "@/lib/ai/client";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireUserKey } from "@/lib/auth/require-user";
import { CATEGORY_IDS, isCategory } from "@/lib/data/brain";
import { heuristicRegion } from "@/lib/brain/classify";

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
  const text = (body.text ?? "").slice(0, 500);
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";

  if (!text.trim()) return Response.json({ category: "thoughts", by: "rules" });

  const ai = getAI();
  if (!ai) return Response.json({ category: heuristicRegion(text), by: "rules" });

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      temperature: 0,
      max_tokens: 20,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt(
            locale,
            `Classify the note into exactly one region of a second brain: ` +
              `goals (an outcome to reach), next (a concrete action to do), ideas, ` +
              `thoughts (reflection), knowledge (a fact or reference), insights (a realisation). ` +
              `Return ONLY JSON: {"category": one of ${CATEGORY_IDS.join(", ")}}.`
          ),
        },
        { role: "user", content: text },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const picked = (JSON.parse(raw) as { category?: string }).category;
    return Response.json(
      isCategory(picked) ? { category: picked, by: "ai" } : { category: heuristicRegion(text), by: "rules" }
    );
  } catch {
    // A model failure must not lose the note — fall back and keep going.
    return Response.json({ category: heuristicRegion(text), by: "rules" });
  }
}
