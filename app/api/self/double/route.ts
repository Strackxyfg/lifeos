import { ai, aiAvailable } from "@/lib/ai/router";
import { quota } from "@/lib/ai/quota";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { loadBrainView } from "@/lib/brain/load";
import { groundAnswer, retrievalQuery } from "@/lib/brain/context";
import { conceptsByUse } from "@/lib/brain/concepts";
import { subjectsOfQuestion } from "@/lib/ai/brain-ai";
import { contextLabels } from "@/lib/brain/labels";
import { getProfile } from "@/lib/user/profile";
import { isValidZone } from "@/lib/reminders/zoned";
import { loadSelfData } from "@/lib/self/store";
import { portraitOf } from "@/lib/self/portrait";
import { localDayHour, summarize } from "@/lib/self/rhythm";
import { doubleSystem, goalRefs, portraitSection, rhythmSection } from "@/lib/self/double";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Turn = { role: "user" | "assistant"; content: string };

/** Small enough that the whole request stays under the provider's per-request limit (7 000 tokens on Groq's free tier). */
const HISTORY = { turns: 6, chars: 1_500 };
const CONTEXT_BUDGET = 4_200;

const encode = (v: unknown) => encodeURIComponent(JSON.stringify(v));

function plain(text: string, source: string): Response {
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI": source } });
}

/**
 * Talking to one's double. The answer streams as text; the actions it may
 * propose come at its end, in a block the page reads and turns into cards
 * (`lib/self/double.ts`) — nothing is done until the person accepts one.
 *
 * What it is given: who they are (their portrait — confirmed traits, and
 * the ones they have not confirmed, marked so), how they have been (their
 * check-ins, as figures with their counts), their open goals, and the part
 * of their brain the question touches (the same grounding as the assistant).
 */
export async function POST(req: Request) {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const body = (await req.json().catch(() => ({}))) as { messages?: Turn[]; locale?: string; zone?: string };
  const locale: Locale = isLocale(body.locale) ? body.locale : "en";
  const m = dictionaries[locale];
  const zone = typeof body.zone === "string" && isValidZone(body.zone) ? body.zone : "UTC";
  const history = (body.messages ?? [])
    .filter((x) => (x.role === "user" || x.role === "assistant") && typeof x.content === "string" && x.content.trim())
    .slice(-HISTORY.turns)
    .map((x) => ({ role: x.role, content: x.content.slice(0, HISTORY.chars) }));
  if (history.at(-1)?.role !== "user") return plain(m.self.talk.failed, "invalid");

  if (!aiAvailable()) return plain(m.self.talk.noAi, "none");
  if (!quota().take(userKey, "double").ok) return plain(m.self.talk.rateLimited, "rate_limit");

  const now = new Date();
  const [{ notes, links }, self, profile] = await Promise.all([loadBrainView(m), loadSelfData(getStore(), userKey), getProfile()]);
  const portrait = portraitOf(self.traits, notes);
  const rhythm = self.checkins.length ? summarize(self.checkins, localDayHour(now, zone).day) : null;
  const goals = goalRefs(notes.filter((n) => n.category === "goals" && !n.done));

  const question = retrievalQuery(history);
  const questionConcepts = await subjectsOfQuestion(question, conceptsByUse(notes));
  const grounding = groundAnswer({
    notes,
    links,
    question,
    now,
    labels: contextLabels(m, locale),
    questionConcepts,
    budget: CONTEXT_BUDGET,
  });

  const name = profile.name === "there" ? undefined : profile.firstName;
  const system = [
    doubleSystem({ name, language: locale === "fr" ? "French" : "English" }),
    "",
    portraitSection(portrait),
    rhythmSection(rhythm) ?? "",
    goals.text,
    "",
    "=== THEIR SECOND BRAIN ===",
    grounding.text,
    "=== END ===",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  try {
    const { tokens, route } = await ai().stream({
      task: "chat",
      temperature: 0.5,
      maxTokens: 700,
      messages: [{ role: "system", content: system }, ...history],
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const token of tokens) controller.enqueue(encoder.encode(token));
        } catch {
          controller.enqueue(encoder.encode(`\n\n${m.self.talk.failed}`));
        }
        controller.close();
      },
    });
    const byId = new Map(notes.map((n) => [n.id, n.title]));
    const sources = grounding.sources.map((id) => ({ id, t: (byId.get(id) ?? "").slice(0, 80) })).filter((s) => s.t);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-AI": route.id,
        "X-Brain-Sources": encode(sources),
        // The goal references the answer's actions may use ("g1" → id).
        "X-Double-Goals": encode(Object.fromEntries(goals.refs)),
      },
    });
  } catch {
    return plain(m.self.talk.failed, "error");
  }
}
