export const NOTION_STATE_COOKIE = "lifeos_notion_state";

export interface NotionTokenResponse {
  access_token: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  bot_id: string;
  /** Only present when the integration installs a template. */
  duplicated_template_id?: string;
  owner?: unknown;
}

/**
 * Exchanges an authorization code for an access token.
 * Notion uses HTTP Basic auth with `client_id:client_secret`.
 */
export async function exchangeCodeForToken(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<
  { ok: true; token: NotionTokenResponse } | { ok: false; status: number; code?: string; message: string }
> {
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      code: typeof body.error === "string" ? body.error : undefined,
      message: typeof body.error_description === "string" ? body.error_description : res.statusText,
    };
  }
  return { ok: true, token: body as unknown as NotionTokenResponse };
}

/**
 * Finds a page the freshly-authorized integration can build into.
 *
 * `duplicated_template_id` only exists for template installs, so for a normal
 * grant we search the pages the user shared during consent and take the first
 * top-level one (a page whose parent is the workspace itself, not another page).
 */
export async function resolveRootPageId(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      filter: { value: "page", property: "object" },
      page_size: 50,
    }),
  });

  if (!res.ok) return null;
  const body = (await res.json()) as { results?: { id: string; parent?: { type?: string } }[] };
  const pages = body.results ?? [];
  if (pages.length === 0) return null;

  const topLevel = pages.find((p) => p.parent?.type === "workspace");
  return (topLevel ?? pages[0]).id;
}
