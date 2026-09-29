"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/store";
import { createRlsClient } from "@/lib/supabase/rls";
import { normalizeDomain } from "@/lib/enterprise/domains";
import { safeNext } from "@/lib/auth/safe-next";
import { appOrigin } from "@/lib/http/origin";

/** `email`: what was typed, handed back so a refused address stays in the field (React resets the form). */
export type SsoState = { ok: boolean; code?: "invalid" | "public" | "unavailable" | "unknown_domain" | "failed"; email?: string };

/**
 * Starts a SAML sign-in from a work address (or a bare domain): Supabase
 * Auth finds the company's identity provider by domain and hands back its
 * sign-in URL; the person goes there, and comes back to /auth/callback.
 * The address itself goes nowhere — only its domain.
 */
export async function startSso(next: string | undefined, _prev: SsoState, formData: FormData): Promise<SsoState> {
  const raw = String(formData.get("email") ?? "").slice(0, 320);
  const n = normalizeDomain(raw);
  if (!n.ok) return { ok: false, code: n.problem === "public" ? "public" : "invalid", email: raw };
  if (!isSupabaseConfigured()) return { ok: false, code: "unavailable", email: raw };

  const supabase = await createRlsClient();
  const back = safeNext(next, "/team");
  const { data, error } = await supabase.auth.signInWithSSO({
    domain: n.domain,
    options: { redirectTo: `${await appOrigin()}/auth/callback?next=${encodeURIComponent(back)}` },
  });
  if (error || !data?.url) {
    const code = (error as { code?: string; status?: number } | null)?.code ?? "";
    const status = (error as { status?: number } | null)?.status ?? 0;
    if (code === "sso_provider_not_found" || status === 404 || /no sso provider/i.test(error?.message ?? "")) return { ok: false, code: "unknown_domain", email: raw };
    if (/saml.*disabled/i.test(error?.message ?? "")) return { ok: false, code: "unavailable", email: raw };
    console.error("[sso] could not start:", error?.message);
    return { ok: false, code: "failed", email: raw };
  }
  redirect(data.url);
}
