import "server-only";

/**
 * SAML identity providers in Supabase Auth, through its admin API
 * (/auth/v1/admin/sso/providers), with the service role. SAML 2.0 must be
 * enabled on the project (Authentication → Providers → SAML 2.0); until
 * it is, Supabase answers 404 and LifeOS says single sign-on is
 * unavailable rather than pretending.
 */

export interface SamlProvider {
  id: string;
  domains: string[];
  entityId: string | null;
}

export type GotrueResult<T> = { ok: true; data: T } | { ok: false; code: "unavailable" | "rejected" | "failed"; message: string };

function config(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

/** Where a company's identity provider sends people back to: Supabase Auth's own SAML endpoints. */
export function serviceProvider(): { entityId: string; acsUrl: string; metadataUrl: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!url) return null;
  const metadata = `${url}/auth/v1/sso/saml/metadata`;
  return { entityId: metadata, acsUrl: `${url}/auth/v1/sso/saml/acs`, metadataUrl: `${metadata}?download=true` };
}

function headers(key: string): Record<string, string> {
  // A legacy service-role key is a JWT and goes as a bearer too; a new
  // secret key (sb_secret_…) goes as the apikey only.
  return { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" };
}

async function call<T>(method: string, path: string, body: unknown, read: (json: Record<string, unknown>) => T): Promise<GotrueResult<T>> {
  const c = config();
  if (!c) return { ok: false, code: "unavailable", message: "Supabase is not configured." };
  let res: Response;
  try {
    res = await fetch(`${c.url}/auth/v1/admin/sso/providers${path}`, {
      method,
      headers: headers(c.key),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, code: "failed", message: err instanceof Error ? err.message : String(err) };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const message = String(json.msg ?? json.message ?? json.error_description ?? json.error ?? `HTTP ${res.status}`).slice(0, 300);
  if (res.status === 404 && method === "POST") return { ok: false, code: "unavailable", message };
  if (res.status === 404 && method === "DELETE") return { ok: true, data: read({}) }; // already gone
  if (res.status >= 400 && res.status < 500) return { ok: false, code: res.status === 404 ? "unavailable" : "rejected", message };
  if (!res.ok) return { ok: false, code: "failed", message };
  return { ok: true, data: read(json) };
}

const provider = (json: Record<string, unknown>): SamlProvider => ({
  id: String(json.id ?? ""),
  domains: Array.isArray(json.domains) ? json.domains.map((d) => String((d as { domain?: unknown }).domain ?? "")).filter(Boolean) : [],
  entityId: typeof (json.saml as { entity_id?: unknown } | undefined)?.entity_id === "string" ? (json.saml as { entity_id: string }).entity_id : null,
});

export function createSamlProvider(input: { metadataUrl?: string; metadataXml?: string; domains: string[] }) {
  return call("POST", "", { type: "saml", metadata_url: input.metadataUrl, metadata_xml: input.metadataXml, domains: input.domains }, provider);
}

export function updateSamlProvider(id: string, input: { metadataUrl?: string; metadataXml?: string; domains?: string[] }) {
  return call("PUT", `/${encodeURIComponent(id)}`, { metadata_url: input.metadataUrl, metadata_xml: input.metadataXml, domains: input.domains }, provider);
}

export function deleteSamlProvider(id: string) {
  return call("DELETE", `/${encodeURIComponent(id)}`, undefined, () => null);
}
