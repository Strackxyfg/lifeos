import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Gates the authenticated app.
 *
 * When Supabase is configured it verifies (and refreshes) the real Supabase
 * Auth session — the refreshed tokens must be written onto the response, which
 * is why the client is built here rather than reused from `lib/supabase/rls`.
 * Without Supabase credentials it falls back to the demo session cookie so the
 * app stays usable with no external services.
 */
export async function middleware(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // A clean login address that says where to come back to, query included:
  // a shared page or a link to a note survives signing in. The login page
  // validates it (`safeNext`) before following it.
  const toLogin = () => {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  };

  if (!supabaseUrl || !supabaseKey) {
    return req.cookies.get(SESSION_COOKIE)?.value ? NextResponse.next() : toLogin();
  }

  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of cookiesToSet) res.cookies.set(name, value, options);
      },
    },
  });

  // getUser() revalidates the token with Supabase — do not trust getSession() here.
  const { data } = await supabase.auth.getUser();
  if (!data.user) return toLogin();

  return res;
}

export const config = {
  matcher: [
    "/hub/:path*",
    "/dashboard/:path*",
    "/projects/:path*",
    "/crm/:path*",
    "/finance/:path*",
    "/review/:path*",
    "/reports/:path*",
    "/assistant/:path*",
    "/brain/:path*",
    "/agent/:path*",
    "/assessment/:path*",
    "/billing/:path*",
    "/settings/:path*",
    "/team/:path*",
    "/join/:path*",
    // Outside the (app) group, but private all the same: setting up a brain
    // writes to it, and signed out there is no brain to write to — only the
    // shared demo one.
    "/onboarding/:path*",
    "/generate/:path*",
    // The share target writes into the brain.
    "/share/:path*",
  ],
};
