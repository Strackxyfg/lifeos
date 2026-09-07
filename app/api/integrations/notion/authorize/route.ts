import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { NOTION_STATE_COOKIE } from "@/lib/notion/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts the Notion OAuth flow.
 *
 * Mints a single-use `state`, stores it in an httpOnly cookie, and sends the
 * user to Notion's consent screen. The callback rejects any response whose
 * state doesn't match — without this, an attacker could hand a victim a
 * pre-baked callback URL and silently bind their own Notion workspace to the
 * victim's account (OAuth CSRF).
 */
export async function GET(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const clientId = process.env.NOTION_CLIENT_ID;
  const redirectUri = process.env.NOTION_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.redirect(`${appUrl}/settings?notion=not_configured`);
  }

  const state = randomBytes(24).toString("hex");
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/settings";

  const authorize = new URL("https://api.notion.com/v1/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("owner", "user");
  authorize.searchParams.set("state", state);

  const res = NextResponse.redirect(authorize.toString());
  res.cookies.set(NOTION_STATE_COOKIE, `${state}:${next}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes is ample for a consent screen
  });
  return res;
}
