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
 * enforces ownership. Without Supabase it falls back to the demo session
 * email, then to a shared demo key for signed-out rendering.
 */
export const getUserKey = cache(async function getUserKey(): Promise<string> {
  if (isSupabaseConfigured()) {
    const { getSupabaseUser } = await import("@/lib/supabase/rls");
    const user = await getSupabaseUser();
    if (user) return user.id;
  }
  const session = await getSession();
  return session?.email ?? DEMO_USER_KEY;
});
