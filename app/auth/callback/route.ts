import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/store";
import { createRlsClient } from "@/lib/supabase/rls";
import { safeNext } from "@/lib/auth/safe-next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Supabase Auth sends people back after a sign-in elsewhere — a
 * company's identity provider (SAML), or an emailed link. The one-time
 * code becomes a session (PKCE: the verifier waited in a cookie); then, for
 * a single sign-on, the person joins their company's team as its directory
 * or its "just in time" rule says — decided by Postgres from the signed
 * token (migration 014's lifeos_sso_join), nothing from this request.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/+$/, "");
  const to = (path: string) => NextResponse.redirect(`${origin}${path}`);
  const next = safeNext(url.searchParams.get("next"), "/team");

  if (!isSupabaseConfigured()) return to("/login");
  const code = url.searchParams.get("code");
  if (!code) {
    const reason = (url.searchParams.get("error_code") ?? url.searchParams.get("error") ?? "failed").replace(/[^a-z_]/gi, "").slice(0, 40);
    return to(`/login/sso?error=${encodeURIComponent(reason || "failed")}`);
  }

  const supabase = await createRlsClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return to("/login/sso?error=exchange");

  const { data, error: joinError } = await supabase.rpc("lifeos_sso_join");
  if (joinError) {
    // Before migration 014 there is nothing to join: signed in, and that is all.
    const pending = /Could not find the function|function .* does not exist|schema cache/i.test(joinError.message);
    if (!pending) console.error("[sso] join:", joinError.message);
    return to(pending ? `/team?sso=pending` : next);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { state?: string; team_id?: string | null } | undefined;
  const state = row?.state ?? "not_sso";
  if (state === "not_sso") return to(next);
  if ((state === "ok" || state === "member") && row?.team_id) return to(next === "/team" ? `/team/${row.team_id}` : next);
  return to(`/team?sso=${encodeURIComponent(state)}`);
}
