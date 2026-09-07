import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Request-scoped Supabase client carrying the signed-in user's JWT.
 *
 * Every query made through it runs as that user, so the Row-Level Security
 * policies are the enforcing layer — unlike `createAdminClient()`, whose
 * service-role key bypasses RLS entirely. Use this for all user data;
 * reserve the admin client for webhooks and other trusted server jobs.
 */
export const createRlsClient = cache(async function createRlsClient() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars are not set");

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
});

/**
 * The authenticated user, or null. Verified against Supabase, not just decoded.
 *
 * Wrapped in `cache()` so the whole render pass shares one `auth.getUser()`
 * round-trip — the layout, the page and every data helper ask for the user, and
 * without this each ask was its own network call to Supabase.
 */
export const getSupabaseUser = cache(async function getSupabaseUser() {
  const supabase = await createRlsClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});
