import { getAI } from "@/lib/ai/client";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { loadSnapshot } from "@/lib/data/live";
import {
  computeInsight, insightPrompt, snapshotFacts,
  type Insight, type InsightKind,
} from "@/lib/ai/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generates the weekly review / daily summary from a real workspace snapshot.
 * Falls back to a deterministic, data-derived insight when no key is set, so
 * the surface is always populated and always factually correct.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string; locale?: string };
  const kind: InsightKind = body.kind === "weekly" ? "weekly" : "daily";
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";

  const snapshot = await loadSnapshot();
  const fallback = computeInsight(kind, snapshot, locale);

  const ai = getAI();
  if (!ai) return Response.json(fallback);

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      temperature: 0.5,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: insightPrompt(kind, locale) },
        { role: "user", content: snapshotFacts(snapshot, locale) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<Insight>;

    // Only trust a well-formed response; otherwise keep the computed one.
    if (!parsed.headline || !parsed.body) return Response.json(fallback);

    const insight: Insight = {
      headline: String(parsed.headline).slice(0, 90),
      body: String(parsed.body).slice(0, 600),
      actions: Array.isArray(parsed.actions)
        ? parsed.actions.filter((a) => typeof a === "string").slice(0, 3)
        : fallback.actions,
      source: "ai",
      generatedAt: new Date().toISOString(),
    };
    return Response.json(insight);
  } catch {
    return Response.json(fallback);
  }
}
