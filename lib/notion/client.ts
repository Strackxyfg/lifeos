/**
 * Minimal, edge-compatible Notion API client (no SDK dependency).
 * Wraps the REST API with typed helpers and consistent error handling.
 * Docs: https://developers.notion.com/reference
 */

const NOTION_VERSION = "2022-06-28";
const BASE = "https://api.notion.com/v1";

export class NotionError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "NotionError";
  }
}

export class NotionClient {
  constructor(private token: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      // Notion is not cacheable for writes; keep reads fresh too.
      cache: "no-store",
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      throw new NotionError(body.message ?? res.statusText, res.status, body.code);
    }
    return res.json() as Promise<T>;
  }

  /** Create a database under a parent page. */
  createDatabase(input: {
    parentPageId: string;
    title: string;
    icon?: string;
    properties: Record<string, NotionPropertySchema>;
  }) {
    return this.request<{ id: string; url: string }>("/databases", {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "page_id", page_id: input.parentPageId },
        icon: input.icon ? { type: "emoji", emoji: input.icon } : undefined,
        title: [{ type: "text", text: { content: input.title } }],
        properties: input.properties,
      }),
    });
  }

  /** Create a page (optionally a row inside a database). */
  createPage(input: {
    parent: { database_id: string } | { page_id: string };
    icon?: string;
    properties?: Record<string, unknown>;
    children?: unknown[];
  }) {
    return this.request<{ id: string; url: string }>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: input.parent,
        icon: input.icon ? { type: "emoji", emoji: input.icon } : undefined,
        properties: input.properties ?? {},
        children: input.children,
      }),
    });
  }

  /** Add a relation property to an existing database (used to wire relations after creation). */
  addRelation(databaseId: string, propName: string, relatedDatabaseId: string) {
    return this.request(`/databases/${databaseId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [propName]: { relation: { database_id: relatedDatabaseId, single_property: {} } },
        },
      }),
    });
  }

  /** Verify the token by fetching the bot user. */
  me() {
    return this.request<{ id: string; name: string }>("/users/me");
  }
}

/** Notion property schema shapes we generate. */
export type NotionPropertySchema =
  | { title: Record<string, never> }
  | { rich_text: Record<string, never> }
  | { number: { format?: string } }
  | { checkbox: Record<string, never> }
  | { date: Record<string, never> }
  | { url: Record<string, never> }
  | { email: Record<string, never> }
  | { select: { options: { name: string; color?: string }[] } }
  | { multi_select: { options: { name: string; color?: string }[] } }
  | { status: Record<string, never> }
  | { people: Record<string, never> }
  | { relation: { database_id: string; single_property: Record<string, never> } };
