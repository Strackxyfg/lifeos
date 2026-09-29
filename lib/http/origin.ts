import "server-only";
import { headers } from "next/headers";

/**
 * This site's origin, for links sent elsewhere (an identity provider's
 * return address, the SCIM tenant URL shown to an owner): the configured
 * NEXT_PUBLIC_APP_URL, else the request's own host.
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
