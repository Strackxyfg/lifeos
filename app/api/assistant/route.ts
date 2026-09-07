import { getAI, systemPrompt } from "@/lib/ai/client";
import { isLocale } from "@/lib/i18n/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

const FALLBACK: Record<string, string> = {
  en: "Here's how I'd play today: clear the investor deck first — it's your only at-risk item — then protect two deep-work blocks and close the three warm leads. (Connect a Groq or Cerebras key to get live, reasoned answers.)",
  fr: "Voici comment j'aborderais la journée : débloquez d'abord le deck investisseurs — votre seul point à risque — puis réservez deux créneaux de concentration et closez les trois leads chauds. (Connectez une clé Groq ou Cerebras pour des réponses générées en direct.)",
};

function streamString(text: string): Response {
  const encoder = new TextEncoder();
  const words = text.split(/(\s+)/);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const w of words) {
        controller.enqueue(encoder.encode(w));
        await new Promise((r) => setTimeout(r, 18));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI": "fallback" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[]; locale?: string };
  const locale = isLocale(body.locale) ? body.locale : "en";
  const history = (body.messages ?? []).slice(-10);

  const ai = getAI();
  if (!ai) return streamString(FALLBACK[locale]);

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      stream: true,
      temperature: 0.6,
      max_tokens: 400,
      messages: [{ role: "system", content: systemPrompt(locale) }, ...history],
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const token = chunk.choices[0]?.delta?.content ?? "";
            if (token) controller.enqueue(encoder.encode(token));
          }
        } catch {
          controller.enqueue(encoder.encode(FALLBACK[locale]));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI": ai.provider },
    });
  } catch {
    return streamString(FALLBACK[locale]);
  }
}
