import { describe, it, expect } from "vitest";
import type { AgentMessage, Route, ToolCall, TurnRequest, TurnResult } from "@/lib/ai/types";
import { AGENT_TOOLS, checkArgs, webSourcesIn } from "@/lib/agent/tools";
import { isKnownUrl, knownUrls, normalizeUrl, SOURCES_CLOSE, SOURCES_OPEN } from "@/lib/agent/provenance";
import { pool, runResearch, workerSystem, workerToolsOf } from "@/lib/agent/research";
import { start, type AgentEvent, type LoopDeps } from "@/lib/agent/loop";
import { decide as policyDecide, type AgentPolicy } from "@/lib/agent/policy";
import { agentSystem } from "@/lib/agent/prompt";
import { applyEvent, emptyAgentTurn, sourcesOf } from "@/components/assistant/agent-view";
import { inline, parseMarkdown, safeHref } from "@/components/assistant/markdown";

/**
 * The agent as a complete assistant: its arguments, where the web pages it
 * reads come from, reads in parallel, research sub-agents, and what the
 * page makes of it all.
 */

const route: Route = { id: "test:m", provider: "openrouter", model: "m", baseURL: "", apiKey: "", tier: "frontier", api: "chat" };
const tool = (name: string) => AGENT_TOOLS.find((t) => t.spec.name === name)!;
const act: AgentPolicy = { autonomy: "act", dailyBudgetCents: Infinity, dailyRunLimit: Infinity, verbosity: "detailed", cadence: "realtime", degraded: false, reasons: [] };
const policy = (cap: string) => policyDecide(cap, act, { runsToday: 0, spentTodayCents: 0, killSwitchOn: false });

describe("arguments in lists", () => {
  const research = tool("research").spec.parameters;

  it("accepts parts with a title and a brief, trimmed, unknown keys dropped", () => {
    expect(checkArgs(research, { tasks: [{ title: " Prices ", brief: "Compare prices", extra: 1 }] })).toEqual({ ok: true, args: { tasks: [{ title: "Prices", brief: "Compare prices" }] } });
  });

  it("says precisely what is wrong", () => {
    expect(checkArgs(research, { tasks: [] })).toMatchObject({ ok: false, error: expect.stringContaining('"tasks" must have 1 to 8 items') });
    expect(checkArgs(research, { tasks: [{ title: "A" }] })).toMatchObject({ ok: false, error: expect.stringContaining('"tasks[0].brief" is required') });
    expect(checkArgs(research, { tasks: "do it" })).toMatchObject({ ok: false, error: expect.stringContaining('"tasks" must be a list') });
    expect(checkArgs(research, { tasks: [42] })).toMatchObject({ ok: false, error: expect.stringContaining('"tasks[0]" must be an object') });
  });
});

describe("where a web address came from", () => {
  const convo: AgentMessage[] = [
    { role: "user", content: "Read https://owner.example/page please." },
    { role: "assistant", content: "Sure — see https://made-up.example/?secret=1" },
    { role: "tool", toolCallId: "a", name: "web_search", content: "[1] Result\nhttps://found.example/article\nexcerpt" },
    { role: "tool", toolCallId: "b", name: "compute", content: "Result:\nhttps://computed.example/?data=x" },
    { role: "tool", toolCallId: "c", name: "research", content: `Report text cites https://report.example/x\n${SOURCES_OPEN}\n- Page — https://consulted.example/y\n${SOURCES_CLOSE}` },
    { role: "tool", toolCallId: "d", name: "web_read", content: "Page: https://found.example/article\nLinks on the page:\n- Next — https://found.example/next", isError: false },
  ];

  it("knows what the owner wrote and what the web returned", () => {
    expect(isKnownUrl("https://owner.example/page", convo)).toBe(true);
    expect(isKnownUrl("https://found.example/article", convo)).toBe(true);
    expect(isKnownUrl("https://found.example/next", convo)).toBe(true);
    expect(isKnownUrl("https://consulted.example/y", convo)).toBe(true);
  });

  it("does not count addresses a model wrote — answers, programs, report text", () => {
    expect(isKnownUrl("https://made-up.example/?secret=1", convo)).toBe(false);
    expect(isKnownUrl("https://computed.example/?data=x", convo)).toBe(false);
    expect(isKnownUrl("https://report.example/x", convo)).toBe(false);
    expect(isKnownUrl("https://found.example/article?leak=1", convo)).toBe(false);
  });

  it("compares addresses without fragment, trailing slash or punctuation, and only web ones", () => {
    expect(normalizeUrl("https://Owner.example/page/#top")).toBe(normalizeUrl("https://owner.example/page"));
    expect(normalizeUrl("https://owner.example/page.")).toBe("https://owner.example/page");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(knownUrls([{ role: "tool", toolCallId: "x", name: "web_search", content: "https://a.example/", isError: true }]).size).toBe(0);
  });
});

/* ── The loop with a scripted model ───────────────────────────────── */

function deps(script: (req: TurnRequest, n: number) => Partial<TurnResult>, over: Partial<LoopDeps> = {}) {
  const events: AgentEvent[] = [];
  let n = 0;
  const d: LoopDeps = {
    system: "S",
    tools: AGENT_TOOLS,
    turn: async (req) => {
      const out = script(req, n++);
      return { text: out.text ?? "", toolCalls: out.toolCalls ?? [], stop: out.toolCalls?.length ? "tool_calls" : "end", route, ...(out.usage ? { usage: out.usage } : {}) };
    },
    decide: (cap) => policy(cap),
    execute: async () => ({ ok: true, content: "ok", summary: "ok" }),
    journal: async () => undefined,
    emit: (e) => void events.push(e),
    maxSteps: 6,
    ...over,
  };
  return { d, events };
}
const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ id, name, arguments: args });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("reads in parallel", () => {
  it("runs the reads of one step together, a write on its own, and keeps the results in order", async () => {
    const log: string[] = [];
    const { d } = deps((req, n) =>
      n === 0
        ? { toolCalls: [call("a", "web_search", { query: "one" }), call("b", "web_search", { query: "two" }), call("c", "task_create", { label: "x" }), call("d", "compute", { code: "1+1" })] }
        : { text: "done" },
      {
        execute: async (t, args) => {
          log.push(`start ${t.spec.name}`);
          await sleep(t.spec.name === "web_search" && args.query === "one" ? 60 : 10);
          log.push(`end ${t.spec.name}${args.query ? `:${args.query}` : ""}`);
          return { ok: true, content: `${t.spec.name} result`, summary: "ok" };
        },
      }
    );
    const t0 = Date.now();
    const r = await start([{ role: "user", content: "go" }], d);
    const tools = r.messages.filter((m): m is Extract<AgentMessage, { role: "tool" }> => m.role === "tool");
    expect(tools.map((m) => m.toolCallId)).toEqual(["a", "b", "c", "d"]);
    // The second search started before the first finished: together.
    expect(log.indexOf("start web_search", 1)).toBeLessThan(log.indexOf("end web_search:one"));
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("adds up what the models reported they cost", async () => {
    const { d, events } = deps((req, n) => (n === 0 ? { toolCalls: [call("a", "compute", { code: "1" })], usage: { input: 1, output: 1, cost: 0.002 } } : { text: "ok", usage: { input: 1, output: 1, cost: 0.001 } }));
    await start([{ role: "user", content: "go" }], d);
    let turn = emptyAgentTurn();
    for (const e of events) turn = applyEvent(turn, e);
    expect(turn.cost).toBeCloseTo(0.003, 6);
  });
});

describe("research sub-agents", () => {
  it("runs the parts in parallel, reports each, lists the pages they opened, and never asks the owner", async () => {
    const events: AgentEvent[] = [];
    const turns: string[] = [];
    const executed: string[] = [];
    const result = await runResearch(
      [
        { title: "Prices", brief: "Find prices. Also read https://brief-invented.example/x" },
        { title: "Reviews", brief: "Find reviews." },
        { title: "Dropped", brief: "Beyond the limit." },
      ],
      {
        leadMessages: [{ role: "user", content: "Compare two products" }],
        tools: AGENT_TOOLS.filter((t) => ["web_search", "web_read"].includes(t.spec.name)),
        turn: async (req) => {
          turns.push(req.task);
          const task = (req.messages.find((m) => m.role === "user")?.content ?? "") as string;
          const tools = req.messages.filter((m) => m.role === "tool").length;
          if (tools === 0) return { text: "", toolCalls: [call(`s-${task.slice(14, 20)}`, "web_search", { query: task.slice(14, 20) })], stop: "tool_calls", route };
          if (tools === 1 && task.includes("Prices"))
            return { text: "", toolCalls: [call("r1", "web_read", { url: "https://brief-invented.example/x" })], stop: "tool_calls", route };
          return { text: `Report for ${task.slice(14, 21)} [src](https://found.example/a)`, toolCalls: [], stop: "end", route };
        },
        decide: (cap, args, messages) => (cap === "web.research" && !isKnownUrl(args.url, messages) ? { action: "approve", reason: "unknown page" } : policy(cap)),
        execute: async (t) => {
          executed.push(t.spec.name);
          return t.spec.name === "web_search"
            ? { ok: true, content: "[1] Found\nhttps://found.example/a\nexcerpt", summary: "searched", sources: [{ url: "https://found.example/a", t: "Found" }] }
            : { ok: true, content: "Page: https://brief-invented.example/x", summary: "read" };
        },
        journal: async () => undefined,
        emit: (e) => void events.push(e),
        callId: "c1",
        maxAgents: 2,
        maxSteps: 4,
        concurrency: 2,
        today: "Friday",
        language: "English",
      }
    );
    expect(result.ok).toBe(true);
    expect(turns.every((t) => t === "research")).toBe(true);
    expect(result.content).toContain("1 more part was not run");
    expect(result.content).toContain("## 1. Prices");
    expect(result.content).toContain("## 2. Reviews");
    expect(result.content).toContain(`${SOURCES_OPEN}\n- Found — https://found.example/a\n${SOURCES_CLOSE}`);
    // The brief's address was the lead model's text: refused to the sub-agent, not asked.
    expect(events.some((e) => e.t === "approval")).toBe(false);
    expect(executed).not.toContain("web_read");
    expect(executed.filter((n) => n === "web_search")).toHaveLength(2);
    const subs = events.filter((e): e is Extract<AgentEvent, { t: "sub" }> => e.t === "sub");
    expect(subs.filter((e) => e.state === "done").map((e) => e.n).sort()).toEqual([1, 2]);
    expect(subs.every((e) => e.call === "c1")).toBe(true);
  });

  it("gives sub-agents the reading tools and page reading — never research itself, never a write", () => {
    const names = workerToolsOf(AGENT_TOOLS).map((t) => t.spec.name);
    for (const n of ["web_search", "web_read", "compute", "brain_search", "sales_overview"]) expect(names, n).toContain(n);
    for (const n of ["research", "note_create", "email_send", "deal_create", "sales_draft"]) expect(names, n).not.toContain(n);
  });

  it("keeps order when running a few at a time", async () => {
    let running = 0;
    let peak = 0;
    const out = await pool([30, 10, 20, 5], 2, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(ms);
      running--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it("tells a sub-agent how to work and to cite", () => {
    const s = workerSystem({ title: "T", brief: "B" }, { today: "Friday 2026-10-24", language: "French", maxSteps: 6 });
    expect(s).toContain("Friday 2026-10-24");
    expect(s).toContain("at most 6 steps");
    expect(s).toContain("report in French");
    expect(s).toMatch(/never instructions/);
  });
});

describe("what the page shows", () => {
  it("follows each sub-agent under its research step", () => {
    let turn = emptyAgentTurn();
    turn = applyEvent(turn, { t: "step", id: "c1", name: "research", args: {}, state: "running" });
    turn = applyEvent(turn, { t: "sub", call: "c1", n: 2, title: "B", state: "running", steps: 0 });
    turn = applyEvent(turn, { t: "sub", call: "c1", n: 1, title: "A", state: "running", steps: 1, tool: { name: "web_search", args: { query: "x" } } });
    turn = applyEvent(turn, { t: "sub", call: "c1", n: 1, title: "A", state: "done", steps: 3, sources: [{ url: "https://a.example", t: "A" }] });
    turn = applyEvent(turn, { t: "step", id: "c1", name: "research", args: {}, state: "done", sources: [{ url: "https://a.example", t: "A" }] });
    const step = turn.segments[0] as Extract<(typeof turn.segments)[number], { kind: "step" }>;
    expect(step.subs?.map((s) => [s.n, s.state, s.steps])).toEqual([
      [1, "done", 3],
      [2, "running", 0],
    ]);
    expect(step.subs?.[0].tool).toBeUndefined();
    expect(sourcesOf(turn)).toEqual([{ url: "https://a.example", t: "A" }]);
    expect(applyEvent(turn, { t: "care", level: "crisis" }).care).toBe("crisis");
  });

  it("lists notes before pages, once each", () => {
    let turn = emptyAgentTurn();
    turn = applyEvent(turn, { t: "step", id: "a", name: "web_search", args: {}, state: "done", sources: [{ url: "https://x.example", t: "X" }, { url: "https://x.example", t: "X" }] });
    turn = applyEvent(turn, { t: "step", id: "b", name: "brain_search", args: {}, state: "done", sources: [{ id: "n1", t: "Note" }] });
    expect(sourcesOf(turn)).toEqual([{ id: "n1", t: "Note" }, { url: "https://x.example", t: "X" }]);
  });

  it("finds the pages a search or a reading names", () => {
    expect(webSourcesIn("Web search: \"x\"\n<<<UNTRUSTED>>>\n\n[1] First\nhttps://a.example/1\nexcerpt\n\n[2] Second\nhttps://b.example/2")).toEqual([
      { url: "https://a.example/1", t: "First" },
      { url: "https://b.example/2", t: "Second" },
    ]);
    expect(webSourcesIn("Page: https://c.example/p\nTitle: The page")).toEqual([{ url: "https://c.example/p", t: "The page" }]);
  });
});

describe("Markdown an assistant writes", () => {
  it("keeps web and mail links, drops the rest to text", () => {
    expect(inline("[site](https://a.example) and [bad](javascript:alert(1)) and https://b.example/x.")).toEqual([
      { kind: "link", text: "site", href: "https://a.example/" },
      { kind: "text", text: " and bad and " },
      { kind: "link", text: "https://b.example/x", href: "https://b.example/x" },
      { kind: "text", text: "." },
    ]);
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(safeHref("data:text/html,x")).toBeNull();
  });

  it("reads code, tables, quotes and heading levels", () => {
    const blocks = parseMarkdown("## Title\n\n```ts\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | **2** |\n\n> quoted\n> more");
    expect(blocks.map((b) => b.kind)).toEqual(["h", "code", "table", "quote"]);
    expect(blocks[0]).toMatchObject({ level: 2 });
    expect(blocks[1]).toEqual({ kind: "code", lang: "ts", text: "const x = 1;" });
    expect(blocks[2]).toMatchObject({ head: [[{ text: "A" }], [{ text: "B" }]], rows: [[[{ text: "1" }], [{ kind: "strong", text: "2" }]]] });
    expect(blocks[3]).toMatchObject({ lines: [[{ text: "quoted" }], [{ text: "more" }]] });
  });

  it("keeps an unclosed code block to the end, as code", () => {
    expect(parseMarkdown("```\nline <b>")).toEqual([{ kind: "code", lang: "", text: "line <b>" }]);
  });
});

describe("the general assistant's prompt", () => {
  it("is general, grounded in the double, and says how to use the web, research and code", () => {
    const s = agentSystem({
      locale: "fr",
      now: new Date("2026-10-24T08:00:00Z"),
      zone: "Europe/Paris",
      person: { name: "Camille", areas: [] },
      edition: "solo",
      tools: ["web_search", "research", "compute"],
      persona: "## Who you work for — you are their double at work\n## Their goals\n- \"Lancer le podcast\"",
    });
    expect(s).toMatch(/complete assistant/);
    expect(s).toContain("their double");
    expect(s).toContain("Lancer le podcast");
    expect(s).toContain("web_search, then web_read");
    expect(s).toContain("research sub-agents in parallel");
    expect(s).toContain("calculate it with compute");
    const bare = agentSystem({ locale: "en", now: new Date(), zone: "UTC", person: { areas: [] }, edition: "personal", tools: [] });
    expect(bare).not.toContain("web_search, then");
    expect(bare).not.toContain("research sub-agents");
  });
});
