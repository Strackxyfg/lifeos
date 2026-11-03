import { z } from "zod";
import { requireUserKey } from "@/lib/auth/require-user";
import { ai, aiAvailable } from "@/lib/ai/router";
import { quota } from "@/lib/ai/quota";
import { TOOL_NAME, type AgentMessage } from "@/lib/ai/types";
import { getStore, isSupabaseConfigured } from "@/lib/db/store";
import { isLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { includes, LIMITS } from "@/lib/plans/editions";
import { getEdition } from "@/lib/plans/server";
import { isValidZone } from "@/lib/reminders/zoned";
import { getProfile } from "@/lib/user/profile";
import { isEmailConfigured } from "@/lib/agent/email";
import { executeCapability } from "@/lib/agent/execute";
import { decider, interactivePolicy } from "@/lib/agent/interactive";
import { journal } from "@/lib/agent/journal";
import { resume, start, type AgentEvent, type LoopDeps, type Outcome } from "@/lib/agent/loop";
import { personaFor } from "@/lib/agent/persona";
import { agentSystem, localNow } from "@/lib/agent/prompt";
import { isKnownUrl } from "@/lib/agent/provenance";
import { runResearch, workerToolsOf, type ResearchTask } from "@/lib/agent/research";
import { searchAvailable } from "@/lib/agent/search";
import { sourcesIn, toolsFor, webSourcesIn, type AgentTool } from "@/lib/agent/tools";
import { readText } from "@/lib/http/body";
import { delegateTool, runSettings, runSpecialists, specialistSystem, specialistTools, type SpecialistContext } from "@/lib/specialists/run";
import { getSpecialistStore } from "@/lib/specialists/store";
import type { Specialist } from "@/lib/specialists/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The agent in the app: one request — a new message, or the owner's
 * decision on an action that waited for it — streamed back as JSON lines
 * (`AgentEvent`), ending with the conversation as it now stands.
 *
 * The conversation lives with the person (their tab), not on the server: it
 * is theirs, it may hold the models' own reasoning for the next step, and
 * keeping it here would need a table for state the person already has. What
 * the browser sends back is checked like any input — its shape, its size,
 * no system message — and nothing in it is trusted to decide anything:
 * which tools exist, whether a call may run and what it does are decided
 * here, on every request. An approval is the owner's own request for that
 * one call; it runs only if the policy, the edition and the kill switch
 * still allow it.
 *
 * Same origin only (the body carries approvals), signed in only, counted
 * per edition.
 */

const MAX_BODY = 1_500_000;

const toolCall = z.object({
  id: z.string().min(1).max(128),
  name: z.string().regex(TOOL_NAME),
  arguments: z.record(z.string(), z.unknown()),
  invalid: z.string().max(2_000).optional(),
});
const replay = z.object({
  provider: z.enum(["groq", "cerebras", "mistral", "deepseek", "openrouter", "anthropic", "openai"]),
  model: z.string().min(1).max(200),
  data: z.unknown(),
});
const message = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string().max(8_000) }),
  z.object({ role: z.literal("assistant"), content: z.string().max(40_000), toolCalls: z.array(toolCall).max(16).optional(), replay: replay.optional() }),
  z.object({ role: z.literal("tool"), toolCallId: z.string().min(1).max(128), name: z.string().max(64), content: z.string().max(40_000), isError: z.boolean().optional() }),
]);
const bodySchema = z
  .object({
    messages: z.array(message).max(400),
    input: z.string().trim().min(1).max(8_000).optional(),
    decision: z.object({ id: z.string().min(1).max(128), approve: z.boolean() }).optional(),
    locale: z.string().optional(),
    zone: z.string().max(64).optional(),
    effort: z.enum(["medium", "high"]).optional(),
    strict: z.boolean().optional(),
    route: z.string().max(200).optional(),
    /** Talking to one of the owner's specialists rather than to the agent. */
    specialist: z.string().min(1).max(64).optional(),
  })
  .refine((b) => (b.input === undefined) !== (b.decision === undefined), "Either a message or a decision.");

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The request comes from a page of this site. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;
  const { userKey } = auth;
  if (!sameOrigin(req)) return json(403, { error: "origin" });
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return json(415, { error: "content_type" });
  if (!aiAvailable()) return json(503, { error: "no_ai" });

  const read = await readText(req, MAX_BODY);
  if (read instanceof Response) return json(413, { error: "too_long" });
  const raw = read.text;
  let parsed: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(JSON.parse(raw));
    if (!result.success) return json(400, { error: "invalid" });
    parsed = result.data;
  } catch {
    return json(400, { error: "invalid" });
  }

  const edition = await getEdition();
  if (!includes(edition, "agent")) return json(403, { error: "edition" });
  const allowed = quota().take(userKey, `agent_${edition}`);
  if (!allowed.ok) return json(429, { error: "quota", retryAfterMs: allowed.retryAfterMs });

  const locale = isLocale(parsed.locale) ? parsed.locale : "en";
  const zone = isValidZone(parsed.zone) ? parsed.zone : "UTC";
  const store = getStore();
  const [profile, reminders, self, policy] = await Promise.all([
    getProfile(),
    store.supportsReminders().catch(() => false),
    store.supportsSelf().catch(() => false),
    interactivePolicy(userKey, parsed.strict === true),
  ]);
  const offered = toolsFor({ edition, supabase: isSupabaseConfigured(), email: isEmailConfigured(), reminders, self, search: searchAvailable() });
  // The owner's specialists: the one spoken to, or those the agent may hand tasks to. Before migration 018, none.
  const specialists: Specialist[] = await (async () => {
    const s = getSpecialistStore();
    return (await s.supports().catch(() => false)) ? await s.list(userKey) : [];
  })();
  const speaking = parsed.specialist ? specialists.find((s) => s.id === parsed.specialist) ?? null : null;
  if (parsed.specialist && !speaking) return json(404, { error: "specialist" });
  const maxAgents = LIMITS[edition].researchAgents;
  // A specialist never gets more than the agent; the agent gets `delegate` once there is someone to delegate to.
  const tools = speaking ? specialistTools(speaking, offered) : [...offered, ...(specialists.length ? [delegateTool(specialists, maxAgents)] : [])];
  const m = dictionaries[locale];
  const now = new Date();
  const person = {
    name: profile.name === "there" ? undefined : profile.name,
    profession: profile.profession,
    areas: profile.areas.map((a) => m.onboarding.areas[a]),
  };
  const history = parsed.messages as AgentMessage[];
  const userMessages = [...history.flatMap((x) => (x.role === "user" ? [x.content] : [])), ...(parsed.input ? [parsed.input] : [])];
  const persona = await personaFor({ store, userKey, locale, zone, now, person, userMessages }).catch((err) => {
    console.error("[agent] persona failed", err instanceof Error ? err.message : err);
    return null;
  });
  const context: SpecialistContext = { locale, now, zone, person, edition, persona: persona?.text };
  const system = speaking
    ? specialistSystem(speaking, tools.map((t) => t.spec.name), context, "direct")
    : agentSystem({ locale, now, zone, person, edition, tools: tools.map((t) => t.spec.name), persona: persona?.text });

  // Web pages may be read freely when their address came from the person or from the web itself (`provenance.ts`).
  const base = decider(policy);
  const decide = (capability: string, args: Record<string, unknown>, messages: AgentMessage[]) =>
    capability === "web.research" && !policy.killSwitch && isKnownUrl(args.url, messages)
      ? { action: "allow" as const, reason: "A page found in this conversation." }
      : base(capability);
  const deep = parsed.effort === "high";
  const turn: LoopDeps["turn"] = async (r) => {
    try {
      return await ai().turn(r);
    } catch (err) {
      // Every route failed: why, for whoever reads the server's log (never the conversation).
      console.warn("[agent] model turn failed:", err instanceof Error ? err.message.slice(0, 300) : err);
      throw err;
    }
  };

  /** One capability, run by the shared executor, with what the page shows of it. */
  const runCapability = async (tool: AgentTool, args: Record<string, unknown>): Promise<Outcome> => {
    // A reminder keeps the person's clock; the model gives the wall time only.
    const payload = tool.capability === "reminder.write" ? { ...args, zone } : args;
    const r = await executeCapability(userKey, tool.capability, payload);
    if (!r.ok) return { ok: false, content: r.error, summary: r.error };
    const content = r.data ? `${r.detail}\n\n${r.data}` : r.detail;
    const created = tool.capability === "brain.write" ? r.data?.match(/^id: (\S+)/)?.[1] : undefined;
    const sources = created
      ? [{ id: created, t: String(args.title ?? "").slice(0, 80) }]
      : tool.capability === "web.search" || tool.capability === "web.research"
        ? webSourcesIn(r.data ?? "")
        : sourcesIn(r.data ?? "");
    return { ok: true, content, summary: r.detail, sources };
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: AgentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      // The lead's conversation as of its latest decision: what its sub-agents may build on.
      let lead: AgentMessage[] = history;
      const workerTools = workerToolsOf(tools);
      const execute: LoopDeps["execute"] = async (tool, args, callId) => {
        if (tool.capability === "agent.delegate") {
          return runSpecialists((args.tasks as { specialist: string; task: string }[]) ?? [], {
            leadMessages: lead,
            turn,
            decide,
            execute: runCapability,
            journal: (entry) => journal(userKey, entry),
            emit,
            callId: callId ?? "delegate",
            maxSteps: LIMITS[edition].researchSteps,
            concurrency: 4,
            signal: req.signal,
            specialists,
            offered,
            maxAgents,
            context,
          });
        }
        if (tool.capability !== "agent.research") return runCapability(tool, args);
        return runResearch((args.tasks as ResearchTask[]) ?? [], {
          leadMessages: lead,
          tools: workerTools,
          turn,
          decide,
          execute: runCapability,
          journal: (entry) => journal(userKey, entry),
          emit,
          callId: callId ?? "research",
          maxAgents: LIMITS[edition].researchAgents,
          maxSteps: LIMITS[edition].researchSteps,
          concurrency: 4,
          today: localNow(now, zone),
          language: locale === "fr" ? "French" : "English",
          signal: req.signal,
        });
      };
      const deps: LoopDeps = {
        system,
        tools,
        turn,
        decide: (capability, args, messages) => {
          lead = messages;
          return decide(capability, args, messages);
        },
        execute,
        journal: (entry) => journal(userKey, entry),
        emit,
        maxSteps: LIMITS[edition].agentSteps,
        // The agent's settings, or the specialist's own depth — "think harder" deepens either.
        ...(speaking
          ? deep
            ? { maxTokens: 12_000, effort: "high" as const, task: "agent_deep" as const }
            : runSettings(speaking.depth)
          : { maxTokens: deep ? 12_000 : 8_000, effort: deep ? ("high" as const) : ("medium" as const), task: deep ? ("agent_deep" as const) : ("agent" as const) }),
        signal: req.signal,
        stickTo: parsed.route,
      };
      if (persona && persona.care !== "none") emit({ t: "care", level: persona.care });
      try {
        const result = parsed.decision
          ? await resume(history, parsed.decision, deps)
          : await start([...history, { role: "user", content: parsed.input as string }], deps);
        emit({ t: "transcript", messages: result.messages });
        emit({ t: "end", stop: result.stop, steps: result.steps });
      } catch (err) {
        console.error("[agent] request failed", err instanceof Error ? err.message : err);
        emit({ t: "error", code: "failed" });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
