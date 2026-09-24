import "server-only";
import { systemPrompt } from "./client";
import { ai, aiAvailable } from "./router";
import { extractJson } from "./json";
import { CATEGORY_IDS, isCategory, type BrainCategoryId } from "@/lib/data/brain";
import { heuristicRegion } from "@/lib/brain/classify";
import type { Locale } from "@/lib/i18n/config";

/**
 * The region a new note belongs to. Classification only: the note's words
 * are kept as said. Never throws — without a model, or when it fails, the
 * keyword rules decide, so a capture is never lost to an outage.
 */
export async function classifyNote(text: string, locale: Locale): Promise<{ category: BrainCategoryId; by: "ai" | "rules" }> {
  const t = text.slice(0, 500);
  if (!t.trim()) return { category: "thoughts", by: "rules" };
  if (!aiAvailable()) return { category: heuristicRegion(t), by: "rules" };
  try {
    const { value } = await ai().complete({
      task: "classify",
      temperature: 0,
      maxTokens: 20,
      json: true,
      // Filing must be quick: a capture waits on it.
      timeoutMs: 8_000,
      validate: (v) => isCategory((extractJson(v) as { category?: unknown } | null)?.category),
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
        { role: "user", content: t },
      ],
    });
    const picked = (extractJson(value) as { category?: string } | null)?.category;
    return isCategory(picked) ? { category: picked, by: "ai" } : { category: heuristicRegion(t), by: "rules" };
  } catch {
    return { category: heuristicRegion(t), by: "rules" };
  }
}
