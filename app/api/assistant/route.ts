import { getAI, systemPrompt } from "@/lib/ai/client";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { requireUserKey } from "@/lib/auth/require-user";
import { loadBrainView } from "@/lib/brain/load";
import { buildBrainContext } from "@/lib/brain/context";
import { computeFocus } from "@/lib/brain/focus";
import { contextLabels, focusReasonText } from "@/lib/brain/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

function streamText(text: string, source: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI": source } });
}

/**
 * The assistant, answering from the user's second brain.
 *
 * Three things changed, each fixing something that pretended:
 *  - It now receives the brain — goals, focus, and the notes related to the
 *    question. Before, it got only the chat and knew nothing about the person.
 *  - Without an AI key it used to stream invented advice ("clear the investor
 *    deck first — it's your only at-risk item") to everyone. It now says the
 *    AI isn't set up and shows what the focus list actually contains.
 *  - When the model failed mid-answer it appended that same invented advice.
 *    It now says the model stopped.
 */
export async function POST(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[]; locale?: string };
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";
  const m = dictionaries[locale];
  const history = (body.messages ?? [])
    .filter((x) => (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .slice(-10)
    .map((x) => ({ role: x.role, content: x.content.slice(0, 4_000) }));
  const question = [...history].reverse().find((x) => x.role === "user")?.content ?? "";

  const { notes, links } = await loadBrainView(m);
  const now = new Date();

  const ai = getAI();
  if (!ai) {
    // No model: tell the truth, then show the part of the brain that answers
    // "what now" without needing one.
    const focus = computeFocus({ notes, links, now, limit: 5 });
    const byId = new Map(notes.map((n) => [n.id, n]));
    const lines = focus
      .map((f) => {
        const n = byId.get(f.id);
        return n ? `• ${n.title} — ${focusReasonText(f.reason, m, locale)}` : null;
      })
      .filter(Boolean);
    const text = lines.length
      ? `${m.assistant.noAi}\n\n${m.assistant.noAiFocus}\n${lines.join("\n")}`
      : `${m.assistant.noAi}\n\n${m.assistant.noAiEmpty}`;
    return streamText(text, "none");
  }

  const context = buildBrainContext({ notes, links, question, now, labels: contextLabels(m, locale) });
  const grounding = [
    "You are the user's second brain — an extension of their own thinking, not a generic assistant.",
    "Below is what they have written in it. Ground every answer in these notes and refer to a note by its title in quotes when you rely on it.",
    "If the notes do not cover the question, say so plainly, then answer from general knowledge and make the switch obvious.",
    "Never invent facts about the user: no figures, deadlines or events they did not write down.",
    "",
    "=== THE USER'S SECOND BRAIN ===",
    context,
    "=== END ===",
  ].join("\n");

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      stream: true,
      temperature: 0.4,
      max_tokens: 500,
      messages: [{ role: "system", content: systemPrompt(locale, grounding) }, ...history],
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
          controller.enqueue(encoder.encode(`\n\n${m.assistant.failed}`));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI": ai.provider },
    });
  } catch {
    return streamText(m.assistant.failed, "error");
  }
}
