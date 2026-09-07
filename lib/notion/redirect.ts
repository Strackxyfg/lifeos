import "server-only";

/**
 * The OAuth redirect URI for the deployment actually serving this request.
 *
 * OAuth requires the `redirect_uri` sent at authorize time to be byte-identical
 * to the one sent at token-exchange time, so both routes must call this.
 *
 * Why not just trust `NOTION_REDIRECT_URI`? Because a stale value is the single
 * most common way this breaks: you deploy to Vercel, the env var still says
 * `http://localhost:3000/...`, and Notion dutifully sends the user to their own
 * machine. So the env var is honoured **only when its origin matches the origin
 * of the current request** — otherwise we derive it from the request itself.
 *
 * Host-header trust is not a hole here: Notion refuses any `redirect_uri` that
 * isn't registered on the integration, so a forged Host cannot redirect a code
 * anywhere the owner hasn't explicitly allow-listed.
 */
export function resolveNotionRedirectUri(req: Request): string {
  const origin = requestOrigin(req);
  const configured = process.env.NOTION_REDIRECT_URI?.trim();

  if (configured) {
    try {
      if (new URL(configured).origin === origin) return configured;
    } catch {
      // Malformed value — fall through to the derived one.
    }
  }
  return `${origin}/api/integrations/notion/callback`;
}

/** Public origin of the current request, honouring Vercel's proxy headers. */
export function requestOrigin(req: Request): string {
  const h = req.headers;
  const forwardedHost = h.get("x-forwarded-host");
  const host = forwardedHost || h.get("host");

  if (host) {
    const proto =
      h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  }

  // Last resort for runtimes that expose neither header.
  return new URL(req.url).origin;
}
