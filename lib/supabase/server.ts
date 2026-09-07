import { createClient } from "@supabase/supabase-js";

/**
 * Anon Supabase client for server components / route handlers.
 * In production, pair with @supabase/ssr to forward the auth cookie so RLS
 * applies per-user. Kept minimal here.
 */
export function createServerClient(accessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars are not set");
  return createClient(url, key, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false },
  });
}
