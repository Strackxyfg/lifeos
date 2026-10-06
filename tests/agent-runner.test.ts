import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The runner as it runs on a server — the real agent-runner/index.mjs, in
 * its own process — against a stand-in LifeOS and a stand-in model on
 * localhost: a message in the inbox comes back answered, through the gate;
 * a refused token makes it wait and say what to do instead of hammering.
 */

const RUNNER = join(__dirname, "..", "agent-runner", "index.mjs");

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let server: Server | null = null;
let runner: ChildProcess | null = null;

afterEach(async () => {
  runner?.kill();
  runner = null;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

function stand(handler: (req: Seen) => { status?: number; json?: unknown }): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const s: Seen = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body };
        seen.push(s);
        const out = handler(s);
        res.writeHead(out.status ?? 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.json ?? {}));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      resolve({ port: typeof addr === "object" && addr ? addr.port : 0, seen });
    });
  });
}

function start(port: number, extra: Record<string, string> = {}): { logs: string[] } {
  const logs: string[] = [];
  const child = spawn(process.execPath, [RUNNER], {
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      LIFEOS_URL: `http://127.0.0.1:${port}`,
      LIFEOS_AGENT_TOKEN: "lifeos_agent_test",
      MODEL_API_KEY: "test-key",
      MODEL_BASE_URL: `http://127.0.0.1:${port}/model`,
      MODEL: "qwen/qwen3.8-27b",
      POLL_MS: "150",
      HOT_POLL_MS: "100",
      AUTONOMOUS_MS: "0",
      HEARTBEAT_FILE: join(mkdtempSync(join(tmpdir(), "lifeos-runner-")), "beat"),
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  runner = child;
  return { logs };
}

const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("the agent runner, end to end", () => {
  it("answers a message from the inbox through the gate, telling Qwen 3 not to think aloud", async () => {
    let served = false;
    const { port, seen } = await stand((r) => {
      if (r.path === "/api/agent/v1/inbox" && r.method === "GET") {
        if (served) return { json: { messages: [], history: [], control: { killSwitch: false } } };
        served = true;
        return {
          json: {
            messages: [{ id: "6f9619ff-8b86-d011-b42d-00c04fc964ff", content: "Bonjour ?", created_at: new Date().toISOString() }],
            history: [],
            control: { killSwitch: false },
          },
        };
      }
      if (r.path === "/api/agent/v1/act") return { json: { decision: "allow", reason: "safe" } };
      if (r.path === "/api/agent/v1/context") return { json: { snapshot: {}, policy: { autonomy: "observe" } } };
      if (r.path === "/model/chat/completions") {
        return { json: { choices: [{ message: { content: JSON.stringify({ text: "Bonjour, je suis là.", action: null }) } }] } };
      }
      return { json: { ok: true } };
    });
    start(port);

    await until(() => seen.some((s) => s.path === "/api/agent/v1/inbox" && s.method === "POST"));
    const reply = JSON.parse(seen.find((s) => s.path === "/api/agent/v1/inbox" && s.method === "POST")!.body);
    expect(reply).toEqual({ replyTo: "6f9619ff-8b86-d011-b42d-00c04fc964ff", content: "Bonjour, je suis là." });

    const model = seen.find((s) => s.path === "/model/chat/completions")!;
    const body = JSON.parse(model.body);
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages.at(-1).content).toMatch(/\/no_think$/);
    expect(model.headers.authorization).toBe("Bearer test-key");

    // Every call to LifeOS carries the token and says which runner it is.
    const toLifeos = seen.filter((s) => s.path.startsWith("/api/agent/"));
    expect(toLifeos.every((s) => s.headers.authorization === "Bearer lifeos_agent_test")).toBe(true);
    expect(toLifeos.every((s) => /^lifeos-agent-runner\/\d+/.test(String(s.headers["user-agent"])))).toBe(true);
  }, 15000);

  it("waits, and says what to do, when LifeOS refuses its token", async () => {
    const { port, seen } = await stand(() => ({ status: 401, json: { error: "unauthorized" } }));
    const { logs } = start(port);

    await until(() => logs.join("").includes("lifeos-agent token"));
    // A minute between tries, not the 150 ms idle poll: one call, then silence.
    await new Promise((r) => setTimeout(r, 1500));
    expect(seen.filter((s) => s.path === "/api/agent/v1/inbox").length).toBe(1);
    expect(logs.join("")).not.toContain("tick failed");
  }, 15000);
});
