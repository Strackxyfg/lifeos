import { NextResponse } from "next/server";
import { handleScim } from "@/lib/enterprise/scim-handler";
import { ScimError, errorBody } from "@/lib/enterprise/scim";
import { getEnterpriseStore } from "@/lib/enterprise/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SCIM 2.0 for a company team's identity provider (Microsoft Entra ID,
 * Okta, …): /api/scim/v2/Users, /Groups and the discovery endpoints.
 * Authenticated by a provisioning token its owner created (only the hash
 * is stored); the token decides the team — nothing in the request can.
 */

const MAX_BODY = 1_000_000;

function reply(status: number, body?: unknown, headers?: Record<string, string>) {
  return new NextResponse(body === undefined || status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/scim+json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/+$/, "");

  let body: unknown;
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const text = await req.text();
    if (text.length > MAX_BODY) return reply(413, errorBody(new ScimError(413, "The request body is too large.")));
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return reply(400, errorBody(new ScimError(400, "The body is not valid JSON.", "invalidSyntax")));
    }
  }

  const res = await handleScim(
    {
      method: req.method,
      segments: path,
      params: url.searchParams,
      body,
      authorization: req.headers.get("authorization"),
      base: `${origin}/api/scim/v2`,
    },
    getEnterpriseStore()
  );
  return reply(res.status, res.body, res.headers);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
