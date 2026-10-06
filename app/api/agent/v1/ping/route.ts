import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/agent/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Is this LifeOS, is my token good, has my agent been heard from?" — for
 * the installer and `lifeos-agent status` on the server.
 *
 * Every answer says `service: "lifeos-agent"`, so a refusal (401) tells the
 * installer the address is right and the token is not, while anything else
 * (a 404 page, a login page) tells it the address is wrong. It reads the
 * token without stamping it as used: checking a token is not the agent
 * running, and the agent page must not say "connected" before it is.
 */
const SERVICE = "lifeos-agent";

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, service: SERVICE, error: "unavailable" }, { status: 503, headers });
  }

  const auth = await authenticateRunner(req, { touch: false });
  if (!auth) return NextResponse.json({ ok: false, service: SERVICE, error: "unauthorized" }, { status: 401, headers });

  const { data: policy } = await createAdminClient()
    .from("agent_policies")
    .select("kill_switch, autonomy")
    .eq("user_key", auth.userKey)
    .maybeSingle();

  const seen = auth.lastUsed ? Date.parse(auth.lastUsed) : NaN;
  return NextResponse.json(
    {
      ok: true,
      service: SERVICE,
      // Seconds since the agent last called in (null: never), measured by this
      // server's clock, so the server's own clock being off does not matter.
      seenSecondsAgo: Number.isFinite(seen) ? Math.max(0, Math.round((Date.now() - seen) / 1000)) : null,
      killSwitch: Boolean(policy?.kill_switch),
      autonomy: policy?.autonomy ?? "observe",
    },
    { headers }
  );
}
