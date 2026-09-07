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

  const toLogin = () => {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
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
    "/dashboard/:path*",
    "/projects/:path*",
    "/crm/:path*",
    "/finance/:path*",
    "/analytics/:path*",
    "/assistant/:path*",
    "/brain/:path*",
    "/agent/:path*",
    "/assessment/:path*",
    "/billing/:path*",
    "/settings/:path*",
    "/team/:path*",
  ],
};
