import { getAI } from "@/lib/ai/client";
import { extractJson } from "@/lib/ai/json";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { loadLinks, loadSnapshot } from "@/lib/data/live";
import { requireUserKey } from "@/lib/auth/require-user";
import { loadBrainView } from "@/lib/brain/load";
import { brainDigest, digestFacts } from "@/lib/brain/digest";
import { focusReasonText } from "@/lib/brain/labels";
import {
  computeInsight, insightPrompt, snapshotFacts,
  type Insight, type InsightKind,
} from "@/lib/ai/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generates the weekly review / daily summary from the second brain first —
 * its focus, tensions and goals without a next step — then the workspace
 * snapshot. Falls back to a deterministic insight from the same facts when no
 * key is set or the model fails, so the surface is always populated and
 * always factually correct.
 */
export async function POST(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { kind?: string; locale?: string };
  const kind: InsightKind = body.kind === "weekly" ? "weekly" : "daily";
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";

  const m = dictionaries[locale];
  const [snapshot, view, { links: rawLinks }] = await Promise.all([loadSnapshot(), loadBrainView(m), loadLinks()]);
  // Links as the app reads them, with the creation date the weekly count needs.
  const created = new Map(rawLinks.map((l) => [l.id, l.createdAt]));
  const digest = brainDigest({
    notes: view.notes,
    links: view.links.map((l) => ({ ...l, createdAt: created.get(l.id) })),
    now: new Date(),
  });
  const fallback = computeInsight(kind, snapshot, locale, digest);

  const ai = getAI();
  if (!ai) return Response.json(fallback);

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      // Low: the briefing quotes the person's notes, and at 0.5 the model
      // began rewording their titles.
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: insightPrompt(kind, locale) },
        {
          role: "user",
          content: `${digestFacts(digest, (r) => focusReasonText(r, m, locale))}\n\n${snapshotFacts(snapshot, locale)}`,
        },
      ],
    });

    // Parsed defensively: a model that thinks aloud or fences its JSON must
    // not throw the briefing away.
    const parsed = (extractJson(completion.choices[0]?.message?.content) ?? {}) as Partial<Insight>;

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
