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
import { agentSystem } from "@/lib/agent/prompt";
import { sourcesIn, toolsFor, type AgentTool } from "@/lib/agent/tools";

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
  arguments: z.record(z.unknown()),
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

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too_long" });
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
  const tools = toolsFor({ edition, supabase: isSupabaseConfigured(), email: isEmailConfigured(), reminders, self });
  const m = dictionaries[locale];
  const system = agentSystem({
    locale,
    now: new Date(),
    zone,
    person: {
      name: profile.name === "there" ? undefined : profile.name,
      profession: profile.profession,
      areas: profile.areas.map((a) => m.onboarding.areas[a]),
    },
    edition,
    tools: tools.map((t) => t.spec.name),
  });

  const execute = async (tool: AgentTool, args: Record<string, unknown>): Promise<Outcome> => {
    // A reminder keeps the person's clock; the model gives the wall time only.
    const payload = tool.capability === "reminder.write" ? { ...args, zone } : args;
    const r = await executeCapability(userKey, tool.capability, payload);
    if (!r.ok) return { ok: false, content: r.error, summary: r.error };
    const content = r.data ? `${r.detail}\n\n${r.data}` : r.detail;
    const created = tool.capability === "brain.write" ? r.data?.match(/^id: (\S+)/)?.[1] : undefined;
    const sources = created ? [{ id: created, t: String(args.title ?? "").slice(0, 80) }] : sourcesIn(r.data ?? "");
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
      const deps: LoopDeps = {
        system,
        tools,
        turn: (r) => ai().turn(r),
        decide: decider(policy),
        execute,
        journal: (entry) => journal(userKey, entry),
        emit,
        maxSteps: LIMITS[edition].agentSteps,
        maxTokens: 4_000,
        effort: parsed.effort ?? "medium",
        signal: req.signal,
        stickTo: parsed.route,
      };
      const history = parsed.messages as AgentMessage[];
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
