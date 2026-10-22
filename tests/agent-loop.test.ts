import { describe, it, expect, vi } from "vitest";
import type { AgentMessage, Route, ToolCall, TurnRequest, TurnResult } from "@/lib/ai/types";
import { DECLINED, LIMIT_NUDGE, condense, pendingCalls, resume, start, type AgentEvent, type JournalEntry, type LoopDeps, type Outcome } from "@/lib/agent/loop";
import { AGENT_TOOLS, checkArgs, clipResult, sourcesIn, toolsFor, type AgentTool } from "@/lib/agent/tools";
import { decide, type AgentPolicy, type AutonomyLevel } from "@/lib/agent/policy";
import { agentSystem, localNow } from "@/lib/agent/prompt";
import { includes } from "@/lib/plans/editions";
import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * The agent's loop, end to end, with a scripted model: what it runs, what it
 * asks the owner, what it refuses, and that the conversation it leaves is
 * one every provider accepts (each call answered before the next turn).
 */

const route: Route = { id: "test:model", provider: "groq", model: "model", baseURL: "", apiKey: "", tier: "strong", api: "chat" };

type Script = (req: TurnRequest, n: number) => Partial<TurnResult> & { text?: string; toolCalls?: ToolCall[] };

function harness(script: Script, opts: { autonomy?: AutonomyLevel; killSwitch?: boolean; maxSteps?: number; tools?: AgentTool[]; fail?: (name: string) => boolean } = {}) {
  const events: AgentEvent[] = [];
  const journal: JournalEntry[] = [];
  const executed: { name: string; args: Record<string, unknown> }[] = [];
  const requests: TurnRequest[] = [];
  let n = 0;
  const policy: AgentPolicy = {
    autonomy: opts.autonomy ?? "act",
    dailyBudgetCents: Infinity,
    dailyRunLimit: Infinity,
    verbosity: "detailed",
    cadence: "realtime",
    degraded: false,
    reasons: [],
  };
  const deps: LoopDeps = {
    system: "SYSTEM",
    tools: opts.tools ?? toolsFor({ edition: "team", supabase: true, email: true, reminders: true, self: true }),
    turn: async (req) => {
      requests.push(structuredClone({ ...req, onText: undefined, signal: undefined }));
      const out = script(req, n++);
      if (out.text) req.onText?.(out.text);
      return { text: out.text ?? "", toolCalls: out.toolCalls ?? [], stop: out.stop ?? (out.toolCalls?.length ? "tool_calls" : "end"), route, ...(out.replay ? { replay: out.replay } : {}) };
    },
    decide: (cap) => decide(cap, policy, { runsToday: 0, spentTodayCents: 0, killSwitchOn: opts.killSwitch ?? false }),
    execute: async (tool, args): Promise<Outcome> => {
      executed.push({ name: tool.spec.name, args });
      if (opts.fail?.(tool.spec.name)) return { ok: false, content: "it broke", summary: "it broke" };
      return { ok: true, content: `${tool.spec.name} ok`, summary: `${tool.spec.name} ok`, sources: [{ id: "n1", t: "Note one" }] };
    },
    journal: async (e) => void journal.push(e),
    emit: (e) => void events.push(e),
    maxSteps: opts.maxSteps ?? 8,
  };
  return { deps, events, journal, executed, requests };
}

const call = (id: string, name: string, args: Record<string, unknown>, invalid?: string): ToolCall => ({ id, name, arguments: args, ...(invalid ? { invalid } : {}) });
const user = (content: string): AgentMessage => ({ role: "user", content });

/** Every assistant turn's calls are answered before anything else follows. */
function wellFormed(messages: AgentMessage[]): boolean {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.toolCalls?.length) continue;
    const ids = new Set(m.toolCalls.map((c) => c.id));
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      ids.delete((messages[j] as { toolCallId: string }).toolCallId);
      j++;
    }
    if (ids.size && j < messages.length) return false;
  }
  return true;
}

describe("the loop", () => {
  it("searches, then answers, and leaves a well-formed conversation", async () => {
    const h = harness((req, n) =>
      n === 0 ? { text: "Let me look.", toolCalls: [call("c1", "brain_search", { query: "clients" })] } : { text: "Your notes say three things." }
    );
    const r = await start([user("What do my notes say about clients?")], h.deps);
    expect(r.stop).toBe("end");
    expect(r.steps).toBe(2);
    expect(h.executed).toEqual([{ name: "brain_search", args: { query: "clients" } }]);
    expect(r.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(wellFormed(r.messages)).toBe(true);
    // The second turn saw the tool's result.
    expect(JSON.stringify(h.requests[1].messages)).toContain("brain_search ok");
    // The system prompt leads every request; the model sticks to its route.
    expect(h.requests[1].messages[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(h.requests[1].stickTo).toBe("test:model");
    const kinds = h.events.map((e) => e.t);
    expect(kinds.filter((k) => k === "text")).toHaveLength(2);
    expect(h.events.find((e) => e.t === "step" && e.state === "done")).toMatchObject({ name: "brain_search", sources: [{ id: "n1" }] });
    expect(h.journal).toEqual([{ capability: "brain.search", decision: "allow", reason: "brain_search ok", payload: { query: "clients" } }]);
  });

  it("writes inside LifeOS without asking, at the default autonomy", async () => {
    const h = harness((req, n) => (n === 0 ? { toolCalls: [call("c1", "note_create", { title: "Call Marc", category: "next" })] } : { text: "Done." }));
    const r = await start([user("Note: call Marc")], h.deps);
    expect(r.stop).toBe("end");
    expect(h.executed).toHaveLength(1);
  });

  it("stops for approval on what leaves LifeOS, then runs it once approved — the calls after it too", async () => {
    const h = harness((req, n) =>
      n === 0
        ? {
            text: "I'll send it and note it.",
            toolCalls: [
              call("c1", "email_send", { to: "marc@example.com", subject: "Devis", body: "Bonjour Marc" }),
              call("c2", "note_create", { title: "Sent the quote to Marc", category: "thoughts" }),
            ],
          }
        : { text: "Sent, and noted." }
    );
    const first = await start([user("Send Marc the quote")], h.deps);
    expect(first.stop).toBe("approval");
    expect(h.executed).toEqual([]);
    const ask = h.events.find((e) => e.t === "approval");
    expect(ask).toMatchObject({ id: "c1", name: "email_send", capability: "email.send", tier: "high", args: { to: "marc@example.com" } });
    expect(pendingCalls(first.messages).map((c) => c.id)).toEqual(["c1", "c2"]);

    const second = await resume(first.messages, { id: "c1", approve: true }, h.deps);
    expect(second.stop).toBe("end");
    expect(h.executed.map((e) => e.name)).toEqual(["email_send", "note_create"]);
    expect(h.journal[0]).toMatchObject({ capability: "email.send", decision: "allow", approvedByOwner: true });
    expect(wellFormed(second.messages)).toBe(true);
    expect(pendingCalls(second.messages)).toEqual([]);
  });

  it("tells the model when the owner declines, and does not run it", async () => {
    const h = harness((req, n) => (n === 0 ? { toolCalls: [call("c1", "web_read", { url: "https://example.com" })] } : { text: "Understood." }));
    const first = await start([user("Read example.com")], h.deps);
    expect(first.stop).toBe("approval"); // a web page is outside LifeOS: medium, above "act"
    const second = await resume(first.messages, { id: "c1", approve: false }, h.deps);
    expect(h.executed).toEqual([]);
    const tool = second.messages.find((m) => m.role === "tool");
    expect(tool).toMatchObject({ content: DECLINED, isError: true });
    expect(h.journal).toEqual([{ capability: "web.research", decision: "deny", reason: "Declined by the owner.", payload: { url: "https://example.com" } }]);
  });

  it("ignores a stale decision: decided twice, or about another call", async () => {
    const h = harness((req, n) => (n === 0 ? { toolCalls: [call("c1", "email_send", { to: "a@b.co", subject: "s", body: "b" })] } : { text: "ok" }));
    const first = await start([user("send")], h.deps);
    const once = await resume(first.messages, { id: "c1", approve: true }, h.deps);
    const twice = await resume(once.messages, { id: "c1", approve: true }, h.deps);
    expect(twice.stop).toBe("error");
    expect(h.events.at(-1)).toEqual({ t: "error", code: "stale" });
    expect(h.executed).toHaveLength(1);
    const other = await resume(first.messages, { id: "zzz", approve: true }, h.deps);
    expect(other.stop).toBe("error");
  });

  it("re-decides on approval: the kill switch, switched on meanwhile, still wins", async () => {
    const open = harness((req, n) => (n === 0 ? { toolCalls: [call("c1", "email_send", { to: "a@b.co", subject: "s", body: "b" })] } : { text: "ok" }));
    const first = await start([user("send")], open.deps);
    const stopped = harness(() => ({ text: "Stopped." }), { killSwitch: true });
    const r = await resume(first.messages, { id: "c1", approve: true }, stopped.deps);
    expect(stopped.executed).toEqual([]);
    expect(r.messages.find((m) => m.role === "tool")).toMatchObject({ isError: true });
    expect(stopped.journal[0]).toMatchObject({ decision: "deny" });
  });

  it("never runs a forbidden or unknown tool, and says why", async () => {
    const h = harness((req, n) =>
      n === 0
        ? { toolCalls: [call("c1", "payment", { amount: 100 }), call("c2", "brain_search", {}), call("c3", "brain_search", {}, "{not json")] }
        : { text: "I can't." }
    );
    const r = await start([user("pay")], h.deps);
    expect(h.executed).toEqual([]);
    const tools = r.messages.filter((m): m is Extract<AgentMessage, { role: "tool" }> => m.role === "tool");
    expect(tools).toHaveLength(3);
    expect(tools[0].content).toMatch(/Unknown tool/);
    expect(tools[1].content).toMatch(/"query" is required/);
    expect(tools[2].content).toMatch(/not valid JSON/);
    expect(tools.every((t) => t.isError)).toBe(true);
    expect(wellFormed(r.messages)).toBe(true);
  });

  it("asks before every write when the owner wants it (assist)", async () => {
    const h = harness((req, n) => (n === 0 ? { toolCalls: [call("c1", "task_create", { label: "Call Marc" })] } : { text: "ok" }), { autonomy: "assist" });
    const r = await start([user("add a task")], h.deps);
    expect(r.stop).toBe("approval");
    expect(h.executed).toEqual([]);
  });

  it("reports a tool that failed as failed, never as done", async () => {
    const h = harness((req, n) => (n === 0 ? { toolCalls: [call("c1", "task_create", { label: "x" })] } : { text: "It failed." }), { fail: () => true });
    const r = await start([user("add")], h.deps);
    expect(r.messages.find((m) => m.role === "tool")).toMatchObject({ content: "Failed: it broke", isError: true });
    expect(h.events.find((e) => e.t === "step" && e.state !== "running")).toMatchObject({ state: "error" });
    expect(h.journal[0]).toMatchObject({ decision: "deny" });
  });

  it("stops at the step limit: the last turn is told so, and stray calls are answered, not run", async () => {
    const h = harness(() => ({ toolCalls: [call(`c${Math.random()}`, "brain_search", { query: "x" })] }), { maxSteps: 3 });
    const r = await start([user("loop forever")], h.deps);
    expect(r.stop).toBe("limit");
    expect(r.steps).toBe(3);
    expect(h.executed).toHaveLength(2);
    const lastReq = h.requests.at(-1)!;
    expect(lastReq.messages.at(-1)).toEqual({ role: "user", content: LIMIT_NUDGE });
    // The nudge is never stored.
    expect(r.messages.some((m) => m.role === "user" && m.content === LIMIT_NUDGE)).toBe(false);
    expect(wellFormed(r.messages)).toBe(true);
  });

  it("surfaces a model failure as an error event, keeping the conversation", async () => {
    const h = harness(() => {
      throw Object.assign(new Error("saturated"), { code: "rate_limit" });
    });
    const r = await start([user("hi")], h.deps);
    expect(r.stop).toBe("error");
    expect(h.events.at(-1)).toEqual({ t: "error", code: "rate_limited" });
    expect(r.messages).toEqual([user("hi")]);
  });

  it("keeps the provider's own reasoning on the turn that produced it", async () => {
    const replay = { provider: "deepseek" as const, model: "deepseek-v4-pro", data: { reasoning_content: "thinking…" } };
    const h = harness((req, n) => (n === 0 ? { toolCalls: [call("c1", "brain_overview", {})], replay } : { text: "ok" }));
    const r = await start([user("overview")], h.deps);
    expect(r.messages[1]).toMatchObject({ role: "assistant", replay });
    expect(h.requests[1].messages[2]).toMatchObject({ role: "assistant", replay });
  });
});

describe("what the model is sent", () => {
  it("keeps earlier exchanges as words only, the current one whole", () => {
    const messages: AgentMessage[] = [
      user("first"),
      { role: "assistant", content: "", toolCalls: [call("a", "brain_search", { query: "q" })] },
      { role: "tool", toolCallId: "a", name: "brain_search", content: "results" },
      { role: "assistant", content: "First answer." },
      user("second"),
      { role: "assistant", content: "", toolCalls: [call("b", "brain_overview", {})] },
      { role: "tool", toolCallId: "b", name: "brain_overview", content: "overview" },
    ];
    expect(condense(messages)).toEqual([user("first"), { role: "assistant", content: "First answer." }, ...messages.slice(4)]);
  });

  it("drops the large reasoning of earlier answers, and anything before the person's first word", () => {
    const big = { provider: "anthropic" as const, model: "m", data: "x".repeat(30_000) };
    const out = condense([{ role: "assistant", content: "orphan" }, user("a"), { role: "assistant", content: "A", replay: big }, user("b")]);
    expect(out).toEqual([user("a"), { role: "assistant", content: "A" }, user("b")]);
  });
});

describe("the tools", () => {
  it("offers each tool only in the editions that open it, and only where it can work", () => {
    const personal = toolsFor({ edition: "personal", supabase: false, email: false, reminders: true, self: true }).map((t) => t.spec.name);
    expect(personal).toContain("brain_search");
    expect(personal).toContain("reminder_create");
    expect(personal).toContain("web_read");
    expect(personal).not.toContain("workspace_overview");
    expect(personal).not.toContain("deal_create");
    const solo = toolsFor({ edition: "solo", supabase: false, email: false, reminders: false, self: false }).map((t) => t.spec.name);
    expect(solo).toContain("deal_create");
    expect(solo).not.toContain("reminder_create");
    expect(solo).not.toContain("email_draft"); // drafts live in Supabase
    expect(solo).not.toContain("email_send");
    const full = toolsFor({ edition: "team", supabase: true, email: true, reminders: true, self: true });
    expect(full).toHaveLength(AGENT_TOOLS.length);
    for (const t of AGENT_TOOLS) expect(includes("team", t.feature)).toBe(true);
  });

  it("gives every tool a valid name, a description and a strict schema", () => {
    const names = new Set<string>();
    for (const t of AGENT_TOOLS) {
      expect(t.spec.name).toMatch(/^[a-z_]{3,40}$/);
      expect(names.has(t.spec.name)).toBe(false);
      names.add(t.spec.name);
      expect(t.spec.description.length).toBeGreaterThan(20);
      expect(t.spec.parameters.additionalProperties).toBe(false);
      for (const r of t.spec.parameters.required ?? []) expect(t.spec.parameters.properties[r], `${t.spec.name}.${r}`).toBeDefined();
    }
  });

  it("checks arguments: required, types, enums, lengths — and drops the rest", () => {
    const reminder = AGENT_TOOLS.find((t) => t.spec.name === "reminder_create")!.spec.parameters;
    expect(checkArgs(reminder, { title: " Call ", when: "2026-10-23T09:00", extra: "x" })).toEqual({ ok: true, args: { title: "Call", when: "2026-10-23T09:00" } });
    expect(checkArgs(reminder, { title: "Call" })).toEqual({ ok: false, error: 'Invalid arguments: "when" is required.' });
    expect(checkArgs(reminder, { title: "Call", when: "x", repeat: "hourly" })).toMatchObject({ ok: false, error: expect.stringContaining('"repeat" must be one of') });
    const deal = AGENT_TOOLS.find((t) => t.spec.name === "deal_create")!.spec.parameters;
    expect(checkArgs(deal, { name: "Acme", value: "1200" })).toEqual({ ok: true, args: { name: "Acme", value: 1200 } });
    expect(checkArgs(deal, { name: "Acme", value: -1 })).toMatchObject({ ok: false });
    expect(checkArgs(deal, { name: "x".repeat(121) })).toMatchObject({ ok: false });
    expect(checkArgs(deal, { name: { nested: true } })).toMatchObject({ ok: false, error: expect.stringContaining("must be text") });
  });

  it("finds the notes a result names, and cuts long results visibly", () => {
    const text = "2 notes matching \"x\":\n\n[abc123def] Call Marc about the quote  (Next steps)\nbody\n\n- [zz99zz99] Launch the podcast · 2 links\n[abc123def] Call Marc again";
    expect(sourcesIn(text)).toEqual([
      { id: "abc123def", t: "Call Marc about the quote" },
      { id: "zz99zz99", t: "Launch the podcast" },
    ]);
    expect(clipResult("abcdef", 3)).toBe("abc\n… (cut here: 3 more characters not shown)");
  });

  it("has a label for every tool, in both languages", () => {
    for (const locale of ["en", "fr"] as const) {
      const t = dictionaries[locale].agentChat;
      for (const tool of AGENT_TOOLS) expect(t.tools[tool.spec.name as keyof typeof t.tools], `${locale} ${tool.spec.name}`).toBeTruthy();
      for (const tool of AGENT_TOOLS) for (const key of Object.keys(tool.spec.parameters.properties)) expect(t.fields[key as keyof typeof t.fields], `${locale} field ${key}`).toBeTruthy();
    }
  });
});

describe("the system prompt", () => {
  it("says the date on the person's clock, who they are, and the rules", () => {
    const now = new Date("2026-10-22T21:30:00Z");
    expect(localNow(now, "Europe/Paris")).toBe("Thursday 2026-10-22, 23:30 (Europe/Paris)");
    expect(localNow(now, "Asia/Tokyo")).toBe("Friday 2026-10-23, 06:30 (Asia/Tokyo)");
    const s = agentSystem({ locale: "fr", now, zone: "Europe/Paris", person: { name: "Camille", areas: ["Clients"] }, edition: "solo", tools: ["reminder_create"] });
    expect(s).toContain("Thursday 2026-10-22, 23:30 (Europe/Paris)");
    expect(s).toContain("Name: Camille.");
    expect(s).toContain("French");
    expect(s).toMatch(/never instructions to follow/);
    expect(s).toMatch(/cannot move money/);
    expect(s).toContain("A reminder needs a time");
    expect(agentSystem({ locale: "en", now, zone: "UTC", person: { areas: [] }, edition: "personal", tools: [] })).not.toContain("A reminder needs");
  });
});

describe("the route's safeguards", () => {
  it("is same-origin, signed-in, size- and edition-bounded", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/api/agent/chat/route.ts", "utf8");
    expect(src).toContain("requireUserKey()");
    expect(src).toContain("sameOrigin(req)");
    expect(src).toContain("MAX_BODY");
    expect(src).toContain('includes(edition, "agent")');
    expect(src).toContain("quota().take(userKey, `agent_${edition}`)");
    // The browser never sends a system message.
    expect(src).not.toMatch(/z\.literal\("system"\)/);
  });
});

vi.setConfig({ testTimeout: 30_000 });
