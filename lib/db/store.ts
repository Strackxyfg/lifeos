import "server-only";
import { cache } from "react";
import type { Store } from "./types";
import { localStore } from "./local-adapter";
import { supabaseStore } from "./supabase-adapter";
import { DEMO_USER_KEY } from "./seed";
import { getSession } from "@/lib/auth/session";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Returns the active backend: Supabase when configured, otherwise a
 * file-backed local store. Both satisfy the same `Store` contract, so callers
 * never branch on which one is live.
 */
export function getStore(): Store {
  return isSupabaseConfigured() ? supabaseStore : localStore;
}

/**
 * Identity every row is scoped by.
 *
 * With Supabase configured this is `auth.uid()` — exactly what the RLS
 * policies compare against (`user_key = auth.uid()::text`), so the database
 * enforces ownership — and, signed out, the shared demo key. Never the demo
 * session cookie there: it is plain base64 anyone can write, and reading it
 * let a forged cookie name any user's id. Without Supabase, the demo session
 * email, then the shared demo key for signed-out rendering.
 */
export const getUserKey = cache(async function getUserKey(): Promise<string> {
  if (isSupabaseConfigured()) {
    const { getSupabaseUser } = await import("@/lib/supabase/rls");
    const user = await getSupabaseUser();
    return user ? user.id : DEMO_USER_KEY;
  }
  const session = await getSession();
  return session?.email ?? DEMO_USER_KEY;
});

/**
 * The signed-in identity, or null — never the shared demo key.
 *
 * `getUserKey()` deliberately falls back to `DEMO_USER_KEY` so signed-out
 * pages still render something. That fallback is fine for reads, and wrong
 * for writes that carry a credential: an OAuth callback that lands here
 * unauthenticated would file a real Notion access token under a key every
 * other signed-out visitor also resolves to, handing them someone else's
 * workspace. Use this wherever writing to the wrong row is a security
 * problem rather than a cosmetic one.
 */
export const getAuthenticatedUserKey = cache(async function getAuthenticatedUserKey(): Promise<
  string | null
> {
  if (isSupabaseConfigured()) {
    const { getSupabaseUser } = await import("@/lib/supabase/rls");
    const user = await getSupabaseUser();
    return user?.id ?? null;
  }
  const session = await getSession();
  return session?.email ?? null;
});
