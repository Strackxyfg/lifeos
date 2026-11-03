"use server";

import { z } from "zod";
import { setSession } from "@/lib/auth/session";
import { createRlsClient } from "@/lib/supabase/rls";
import { isSupabaseConfigured } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";

const schema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  password: z.string().min(8),
});

type AuthWords = Awaited<ReturnType<typeof getMessages>>["auth"]["errors"];

/** Supabase's error codes, in the person's language; its own sentences are English and say too much or too little. */
function authError(code: string | undefined, words: AuthWords): string {
  switch (code) {
    case "invalid_credentials":
      return words.credentials;
    case "user_already_exists":
    case "email_exists":
      return words.exists;
    case "email_not_confirmed":
      return words.unconfirmed;
    case "weak_password":
      return words.weak;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return words.rate;
    default:
      return words.failed;
  }
}

export type AuthState = { ok: boolean; message?: string };

/**
 * Sign in / sign up. Bound with the mode via `.bind(null, mode)`.
 *
 * Uses real Supabase Auth when configured — the session lands in httpOnly
 * cookies and every subsequent query runs under RLS as that user. Falls back
 * to the demo session cookie when Supabase env vars are absent, so the app
 * remains fully navigable with no external services.
 */
export async function authenticate(
  mode: "login" | "signup",
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const words = (await getMessages()).auth.errors;
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.path[0] === "password" ? words.password : words.email };
  }
  const { email, password } = parsed.data;

  if (!isSupabaseConfigured()) {
    await new Promise((r) => setTimeout(r, 400));
    await setSession({ email });
    return { ok: true };
  }

  const supabase = await createRlsClient();

  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.warn("[auth] sign-up refused:", error.code ?? error.status);
      return { ok: false, message: authError(error.code, words) };
    }
    // With "Confirm email" enabled, no session is returned until the user clicks
    // the link — say so instead of silently bouncing them back to the form.
    if (!data.session) {
      return { ok: false, message: words.confirm };
    }
    return { ok: true };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: authError(error.code, words) };
  return { ok: true };
}
