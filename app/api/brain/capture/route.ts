import { getAI, systemPrompt } from "@/lib/ai/client";
import { isLocale, type Locale } from "@/lib/i18n/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = ["ideas", "thoughts", "next", "knowledge", "insights"] as const;
type Category = (typeof CATEGORIES)[number];

function heuristic(text: string): Category {
  const t = text.toLowerCase();
  if (/\b(todo|to-do|faire|ship|call|email|fix|envoyer|appeler|finish|reply|répondre)\b/.test(t)) return "next";
  if (/\b(idea|idée|what if|et si|concept|feature|maybe|peut-être)\b/.test(t)) return "ideas";
  if (/\b(learned|noted|fact|remember|retenir|because|parce que)\b/.test(t)) return "knowledge";
  if (text.trim().endsWith("?")) return "thoughts";
  return "thoughts";
}

const NOTE: Record<Locale, (c: Category) => string> = {
  en: (c) => `Filed under ${c}.`,
  fr: (c) => `Classé dans « ${c} ».`,
};

/**
 * Routes a captured thought to a Second-Brain region and returns a short note.
 * Uses the LLM when configured; otherwise a keyword heuristic.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; locale?: string };
  const text = (body.text ?? "").slice(0, 500);
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";

  if (!text.trim()) {
    return Response.json({ category: "thoughts" as Category, note: "" });
  }

  const ai = getAI();
  if (!ai) {
    const category = heuristic(text);
    return Response.json({ category, note: NOTE[locale](category) });
  }

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      temperature: 0.2,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt(
            locale,
            `Classify the note into exactly one region: ${CATEGORIES.join(", ")}. Return ONLY JSON: {"category": <region>, "note": <one short sentence, max 12 words>}.`
          ),
        },
        { role: "user", content: text },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { category?: string; note?: string };
    const category = (CATEGORIES as readonly string[]).includes(parsed.category ?? "")
      ? (parsed.category as Category)
      : heuristic(text);
    return Response.json({ category, note: parsed.note ?? NOTE[locale](category) });
  } catch {
    const category = heuristic(text);
    return Response.json({ category, note: NOTE[locale](category) });
  }
}
