"use server";

import { z } from "zod";
import { setSession } from "@/lib/auth/session";
import { createRlsClient } from "@/lib/supabase/rls";
import { isSupabaseConfigured } from "@/lib/db/store";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address.").transform((v) => v.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

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

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check your details." };
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
    if (error) return { ok: false, message: error.message };
    // With "Confirm email" enabled, no session is returned until the user clicks
    // the link — say so instead of silently bouncing them back to the form.
    if (!data.session) {
      return { ok: false, message: "Check your inbox to confirm your email, then sign in." };
    }
    return { ok: true };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
