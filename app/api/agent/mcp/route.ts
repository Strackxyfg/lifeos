import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/agent/token";
import { runCapability } from "@/lib/agent/gate";
import { listMcpTools, fromToolName, negotiateProtocolVersion, SUPPORTED_PROTOCOL_VERSIONS } from "@/lib/agent/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP server — how Hermes Agent (and any other MCP client) drives LifeOS.
 *
 * This is the piece that lets us adopt Hermes without handing it anything
 * dangerous. Hermes brings what it is good at — the messaging gateway,
 * persistent memory, cron, model routing — and calls in here for anything that
 * touches the user's data or the outside world. It holds one scoped, revocable
 * bearer token and nothing else: no database, no Notion token, no mail
 * credentials. Every tool call lands on the same policy engine as the REST
 * runner, so the guardrails, quotas, kill switch and audit log all still apply.
 *
 * JSON-RPC 2.0 over HTTP (MCP's streamable-HTTP transport, non-streaming).
 */

const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export async function POST(req: Request) {
  const auth = await authenticateRunner(req);
  if (!auth) {
    // MCP clients look for 401 to know the token is the problem.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as RpcRequest | RpcRequest[] | null;
  if (!body) return rpcError(null, -32700, "Parse error");

  // A batch is legal JSON-RPC; answer each and drop notification responses.
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map((r) => handle(r, auth.userKey)));
    const answers = results.filter((r) => r !== null);
    return answers.length ? NextResponse.json(answers) : new Response(null, { status: 204 });
  }

  const result = await handle(body, auth.userKey);
  return result === null ? new Response(null, { status: 204 }) : NextResponse.json(result);
}

async function handle(rpc: RpcRequest, userKey: string) {
  const { id = null, method, params = {} } = rpc;
  // Notifications have no id and expect no response.
  const isNotification = rpc.id === undefined;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lifeos", version: "1.0.0" },
        instructions:
          "LifeOS is the user's second brain and business workspace. Every tool call " +
          "passes a policy engine that may allow, queue for approval, or deny it. " +
          "A 'queued for approval' answer means nothing happened yet — report that " +
          "honestly and never claim an action succeeded unless the result says it did. " +
          "Prefer the *_draft tools over sending: drafting is unrestricted, sending " +
          "needs the owner.",
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: listMcpTools() });

    // We advertise only `tools`, so a well-behaved client never asks for
    // these. Some ask anyway; an empty list is quieter than a protocol error
    // and tells them there is genuinely nothing there.
    case "resources/list":
      return ok(id, { resources: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });

    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      const capability = fromToolName(name);
      if (!capability) {
        return ok(id, {
          content: [{ type: "text", text: `Unknown tool "${name}".` }],
          isError: true,
        });
      }

      const outcome = await runCapability(userKey, capability, args, 1);

      // Report the decision as tool content, not as a transport error: the
      // model needs to read "this needs approval" and adapt, and a protocol
      // error would just look like a broken server.
      const prefix =
        outcome.decision === "allow" ? "✅ " : outcome.decision === "approve" ? "⏳ " : "🚫 ";

      const text = outcome.data ? `${prefix}${outcome.reason}

${outcome.data}` : prefix + outcome.reason;
      return ok(id, {
        content: [{ type: "text", text }],
        isError: outcome.decision === "deny",
      });
    }

    default:
      // Every notification is fire-and-forget, not just the initialized one.
      if (isNotification || method?.startsWith("notifications/")) return null;
      return err(id, -32601, `Method not found: ${method}`);
  }
}

function ok(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function err(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return NextResponse.json(err(id, code, message), { status: 400 });
}

/** Some MCP clients probe with GET before opening a session. */
export async function GET() {
  return NextResponse.json({
    name: "lifeos",
    protocolVersion: PROTOCOL_VERSION,
    transport: "streamable-http",
    authentication: "Bearer <lifeos_agent_ token>",
  });
}
