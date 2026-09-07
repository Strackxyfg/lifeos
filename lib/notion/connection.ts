import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/db/store";

export interface NotionConnection {
  token: string;
  rootPageId: string;
  /** `oauth` = per-user connection; `env` = single-workspace dev/internal token. */
  source: "oauth" | "env";
}

/**
 * Resolves the Notion credentials to build into, in priority order:
 *
 *  1. The user's stored OAuth connection (multi-tenant, what ships to customers).
 *  2. `NOTION_TOKEN` + `NOTION_ROOT_PAGE_ID` from env — an *internal* Notion
 *     integration. Far quicker to set up and enough to build into your own
 *     workspace while developing.
 *
 * Returns null when neither is available, in which case generation runs as a
 * clearly-labelled simulation instead of silently pretending to work.
 */
export async function getNotionConnection(userKey: string): Promise<NotionConnection | null> {
  if (isSupabaseConfigured()) {
    try {
      const db = createAdminClient();
      const { data } = await db
        .from("notion_connections")
        .select("access_token, root_page_id")
        .eq("user_key", userKey)
        .maybeSingle();

      if (data?.access_token && data.root_page_id) {
        return { token: data.access_token, rootPageId: data.root_page_id, source: "oauth" };
      }
    } catch {
      // Table may predate the user_key column; fall through to env.
    }
  }

  const token = process.env.NOTION_TOKEN;
  const rootPageId = process.env.NOTION_ROOT_PAGE_ID;
  if (token && rootPageId) {
    return { token, rootPageId: normalizePageId(rootPageId), source: "env" };
  }

  return null;
}

/** Connection state for the Settings UI. */
export async function getNotionStatus(): Promise<{
  connected: boolean;
  workspaceName: string | null;
  source: "oauth" | "env" | null;
}> {
  const { getUserKey } = await import("@/lib/db/store");
  try {
    const userKey = await getUserKey();
    if (isSupabaseConfigured()) {
      const db = createAdminClient();
      const { data } = await db
        .from("notion_connections")
        .select("workspace_name, access_token, root_page_id")
        .eq("user_key", userKey)
        .maybeSingle();
      if (data?.access_token && data.root_page_id) {
        return { connected: true, workspaceName: data.workspace_name ?? null, source: "oauth" };
      }
    }
  } catch {
    /* fall through */
  }
  if (process.env.NOTION_TOKEN && process.env.NOTION_ROOT_PAGE_ID) {
    return { connected: true, workspaceName: null, source: "env" };
  }
  return { connected: false, workspaceName: null, source: null };
}

/**
 * Accepts a raw id, a dashed UUID, or a full Notion URL and returns the
 * dashed UUID the API expects. Notion URLs end with a 32-char hex id.
 */
export function normalizePageId(input: string): string {
  const hex = input.trim().replace(/^.*[-/]/, "").replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 32) return input.trim();
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
  ].join("-");
}
