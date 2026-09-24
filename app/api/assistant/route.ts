import { systemPrompt } from "@/lib/ai/client";
import { ai, aiAvailable } from "@/lib/ai/router";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { requireUserKey } from "@/lib/auth/require-user";
import { loadBrainView } from "@/lib/brain/load";
import { groundAnswer, retrievalQuery, type ThoughtTrace } from "@/lib/brain/context";
import { conceptsByUse } from "@/lib/brain/concepts";
import { subjectsOfQuestion } from "@/lib/ai/brain-ai";
import { computeFocus } from "@/lib/brain/focus";
import { contextLabels, focusReasonText } from "@/lib/brain/labels";
import { getProfile } from "@/lib/user/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * The notes an answer was grounded in, for the client to show as sources.
 * A header, so the answer itself can keep streaming as plain text; encoded,
 * because header values must be ASCII and titles are not.
 */
function sourcesHeader(ids: string[], notes: { id: string; title: string }[]): string {
  const byId = new Map(notes.map((n) => [n.id, n.title]));
  const list = ids
    .map((id) => ({ id, t: (byId.get(id) ?? "").slice(0, 80) }))
    .filter((s) => s.t);
  return encodeURIComponent(JSON.stringify(list));
}

/**
 * How the brain was read, for the brain page to draw. Ids and short words
 * only; encoded like the sources.
 */
function traceHeader(trace: ThoughtTrace): string {
  return encodeURIComponent(JSON.stringify(trace));
}

function streamText(text: string, source: string, sources = "", trace = ""): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI": source, "X-Brain-Sources": sources, "X-Brain-Trace": trace },
  });
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

  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[]; locale?: string; voice?: boolean };
  // A spoken conversation: the answer is heard, not read.
  const spoken = body.voice === true;
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";
  const m = dictionaries[locale];
  const history = (body.messages ?? [])
    .filter((x) => (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .slice(-10)
    .map((x) => ({ role: x.role, content: x.content.slice(0, 4_000) }));
  // What the brain is searched with: the question, or a short follow-up with the question before it.
  const question = retrievalQuery(history);

  const { notes, links } = await loadBrainView(m);
  const now = new Date();
  const labels = contextLabels(m, locale);

  if (!aiAvailable()) {
    // No model: tell the truth, then show what the brain itself holds on the
    // question — relevance needs no model — or, failing that, the part of it
    // that answers "what now".
    const { trace } = groundAnswer({ notes, links, question, now, labels });
    const byTitle = new Map(notes.map((n) => [n.id, n.title]));
    const found = [...trace.seeds.map((s) => s.id), ...trace.hops.map((h) => h.to)].filter(
      (id, i, all) => all.indexOf(id) === i && byTitle.has(id)
    );
    if (found.length > 0) {
      const text = `${m.assistant.noAi}\n\n${m.assistant.noAiRelevant}\n${found.map((id) => `• ${byTitle.get(id)}`).join("\n")}`;
      return streamText(text, "none", sourcesHeader(found.slice(0, 6), notes), traceHeader(trace));
    }
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
    return streamText(text, "none", sourcesHeader(focus.map((f) => f.id), notes));
  }

  // Who is asking — the answers they gave at onboarding — and what the
  // question is about in the brain's own subjects. Fetched together: the
  // mapping is a model call, and the profile a read.
  const [profile, questionConcepts] = await Promise.all([getProfile(), subjectsOfQuestion(question, conceptsByUse(notes))]);
  const person = {
    name: profile.name === "there" ? undefined : profile.name,
    profession: profile.profession,
    areas: profile.areas.map((a) => m.onboarding.areas[a]),
  };
  const { text: context, sources, trace } = groundAnswer({ notes, links, question, now, labels, person, questionConcepts });
  const grounding = [
    "You are the user's second brain — an extension of their own thinking, not a generic assistant.",
    "Below is what they have written in it. Ground every answer in these notes and refer to a note by its title in quotes when you rely on it.",
    "The headings (goals, focus, related notes…) are sections, not notes: never quote a heading as if it were a note.",
    "A line starting with ↳ is a connection between two notes — use it: it says how they relate and why.",
    "If the notes do not cover the question, say so plainly, then answer from general knowledge and make the switch obvious.",
    "Never invent facts about the user: no figures, deadlines or events they did not write down.",
    ...(spoken
      ? [
          "This answer will be read aloud in a spoken conversation: two to four short sentences, the way a person",
          "talks. No lists, no headings, no bold, no symbols. Name a note by its title only when it matters.",
        ]
      : []),
    "",
    "=== THE USER'S SECOND BRAIN ===",
    context,
    "=== END ===",
  ].join("\n");

  try {
    // Failover happens until the first token: if the preferred model is out
    // of quota, the next one answers and the person never sees the switch.
    const { tokens, route } = await ai().stream({
      task: "chat",
      temperature: 0.4,
      maxTokens: spoken ? 220 : 500,
      messages: [{ role: "system", content: systemPrompt(locale, grounding) }, ...history],
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const token of tokens) controller.enqueue(encoder.encode(token));
        } catch {
          controller.enqueue(encoder.encode(`\n\n${m.assistant.failed}`));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-AI": route.id,
        "X-Brain-Sources": sourcesHeader(sources, notes),
        "X-Brain-Trace": traceHeader(trace),
      },
    });
  } catch {
    return streamText(m.assistant.failed, "error");
  }
}
