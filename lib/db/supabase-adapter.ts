import { createAdminClient } from "@/lib/supabase/admin";
import { createRlsClient } from "@/lib/supabase/rls";
import type { Collection, Dataset, Store } from "./types";
import { seedDataset, shouldSeed } from "./seed";

/**
 * All user data goes through the request-scoped RLS client, so Postgres
 * policies enforce ownership. `createAdminClient` stays available for trusted
 * server jobs (webhooks) but is deliberately not used for user rows.
 *
 * Set `LIFEOS_DB_ADMIN=1` only for maintenance scripts that must bypass RLS.
 */
async function client() {
  return process.env.LIFEOS_DB_ADMIN === "1" ? createAdminClient() : createRlsClient();
}

/** Postgres table backing each collection. */
const TABLE: Record<Collection, string> = {
  projects: "lifeos_projects",
  deals: "lifeos_deals",
  transactions: "lifeos_transactions",
  tasks: "lifeos_tasks",
  brain: "lifeos_brain_items",
};

/** camelCase (TS) → snake_case (Postgres). */
function toColumn(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toRow(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toColumn(k), v]));
}

function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

/**
 * Supabase-backed store.
 *
 * Uses the service-role client and scopes **every** query by `user_key`
 * explicitly. That is required because the app currently authenticates with
 * its own session cookie rather than a Supabase Auth JWT, so RLS has no
 * `auth.uid()` to match on. Once Supabase Auth is wired, swap to the anon
 * client with the user's JWT and RLS becomes the enforcing layer — the
 * policies in the migration are already written for it.
 */
class SupabaseStore implements Store {
  readonly backend = "supabase" as const;

  /**
   * In-flight seed operations, keyed `user:collection`. A single request fans
   * out several reads (layout alerts + page data), so without this two
   * concurrent first-reads would both seed and duplicate every row.
   */
  private seeding = new Map<string, Promise<void>>();

  async list<C extends Collection>(userKey: string, collection: C): Promise<Dataset[C]> {
    const rows = await this.fetch(userKey, collection);
    if (rows.length > 0) return rows;

    // Real accounts start empty; only the demo identity gets sample content.
    if (!shouldSeed(userKey)) return rows;

    await this.ensureSeeded(userKey, collection);
    return this.fetch(userKey, collection);
  }

  private async fetch<C extends Collection>(userKey: string, collection: C): Promise<Dataset[C]> {
    const db = await client();
    const { data, error } = await db
      .from(TABLE[collection])
      .select("*")
      .eq("user_key", userKey)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`[supabase] list ${collection}: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r)) as Dataset[C];
  }

  private ensureSeeded(userKey: string, collection: Collection): Promise<void> {
    const key = `${userKey}:${collection}`;
    let inflight = this.seeding.get(key);
    if (!inflight) {
      inflight = this.seedOnce(userKey, collection).finally(() => this.seeding.delete(key));
      this.seeding.set(key, inflight);
    }
    return inflight;
  }

  private async seedOnce(userKey: string, collection: Collection): Promise<void> {
    const db = await client();

    // Re-check inside the lock: another request may have seeded already.
    const { count } = await db
      .from(TABLE[collection])
      .select("*", { count: "exact", head: true })
      .eq("user_key", userKey);
    if ((count ?? 0) > 0) return;

    const rows = seedDataset(userKey)[collection];
    if (rows.length === 0) return;

    // Drop `id`: the seed's local ids ("prj_0") aren't UUIDs, so Postgres must
    // generate them. `created_at` is kept — it's staggered to preserve order.
    const payload = rows.map(({ id: _id, ...rest }) => toRow(rest as Record<string, unknown>));

    const { error } = await db.from(TABLE[collection]).insert(payload);
    // Surface failures instead of silently returning an empty workspace.
    if (error) throw new Error(`[supabase] seed ${collection}: ${error.message}`);
  }

  async insert<C extends Collection>(
    userKey: string,
    collection: C,
    row: Omit<Dataset[C][number], "id" | "userKey" | "createdAt">
  ): Promise<Dataset[C][number]> {
    const db = await client();
    const { data, error } = await db
      .from(TABLE[collection])
      .insert(toRow({ ...row, userKey }))
      .select()
      .single();

    if (error) throw new Error(`[supabase] insert ${collection}: ${error.message}`);
    return fromRow(data) as Dataset[C][number];
  }

  async update<C extends Collection>(
    userKey: string,
    collection: C,
    id: string,
    patch: Partial<Dataset[C][number]>
  ): Promise<void> {
    const db = await client();
    // Never let a caller move a row to another owner.
    const { id: _id, userKey: _uk, createdAt: _ca, ...safe } = patch as Record<string, unknown>;
    const { error } = await db
      .from(TABLE[collection])
      .update(toRow(safe))
      .eq("id", id)
      .eq("user_key", userKey);

    if (error) throw new Error(`[supabase] update ${collection}: ${error.message}`);
  }

  async remove(userKey: string, collection: Collection, id: string): Promise<void> {
    const db = await client();
    const { error } = await db
      .from(TABLE[collection])
      .delete()
      .eq("id", id)
      .eq("user_key", userKey);

    if (error) throw new Error(`[supabase] remove ${collection}: ${error.message}`);
  }
}

export const supabaseStore = new SupabaseStore();
export { toColumn, toRow, fromRow, TABLE };
