import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserKey, isSupabaseConfigured } from "@/lib/db/store";
import { NOTION_STATE_COOKIE, exchangeCodeForToken, resolveRootPageId } from "@/lib/notion/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Notion public OAuth callback.
 *
 * Verifies the CSRF `state`, exchanges the code for a token, resolves a root
 * page to build into, and stores the connection scoped to the current user.
 * Every failure redirects back with a specific `notion=<reason>` so the UI can
 * explain what went wrong instead of failing silently.
 */
export async function GET(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const stored = store.get(NOTION_STATE_COOKIE)?.value;
  const [expectedState, next = "/settings"] = (stored ?? "").split(":");

  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${appUrl}${next}?notion=${reason}`);
    res.cookies.delete(NOTION_STATE_COOKIE);
    return res;
  };

  if (oauthError) return fail("denied");
  if (!code) return fail("no_code");

  // CSRF: the state must match the one we minted for this browser.
  if (!expectedState || !state || state !== expectedState) return fail("bad_state");

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return fail("not_configured");

  const exchange = await exchangeCodeForToken({ code, clientId, clientSecret, redirectUri });
  if (!exchange.ok) {
    console.error("[notion oauth] token exchange failed:", exchange.status, exchange.code, exchange.message);
    return fail(exchange.status === 401 ? "bad_credentials" : "exchange_failed");
  }

  const token = exchange.token;
  const rootPageId = token.duplicated_template_id ?? (await resolveRootPageId(token.access_token));
  if (!rootPageId) return fail("no_page_shared");

  if (!isSupabaseConfigured()) {
    // Nothing to persist into; the env token path still works.
    return fail("no_database");
  }

  try {
    const userKey = await getUserKey();
    const db = createAdminClient();
    const { error } = await db.from("notion_connections").upsert(
      {
        user_key: userKey,
        workspace_id: token.workspace_id,
        workspace_name: token.workspace_name ?? null,
        access_token: token.access_token, // TODO: encrypt at rest (pgcrypto/KMS)
        bot_id: token.bot_id,
        root_page_id: rootPageId,
      },
      { onConflict: "user_key" }
    );
    if (error) {
      console.error("[notion oauth] store failed:", error.message);
      return fail("store_failed");
    }
  } catch (err) {
    console.error("[notion oauth] store threw:", err);
    return fail("store_failed");
  }

  const res = NextResponse.redirect(`${appUrl}${next}?notion=connected`);
  res.cookies.delete(NOTION_STATE_COOKIE);
  return res;
}
