import { createRlsClient } from "@/lib/supabase/rls";
import type { Totals } from "./compute";
import type { CatalogItem, Client, DocContent, DocKind, DocState, Issuer, SalesDoc } from "./model";
import type { SalesStore } from "./store";

/**
 * Sales in Supabase (migration 017), through the request's own session: the
 * row-level policies keep each person to their rows, and the database's
 * trigger and functions keep the invoicing rules (`017_sales.sql`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (what: string, message: string): never => {
  throw new Error(`[sales] ${what}: ${message}`);
};

type ClientRow = { id: string; name: string; data: Omit<Client, "id" | "name" | "archived" | "createdAt" | "updatedAt">; archived: boolean; created_at: string; updated_at: string };
type CatalogRow = { id: string; name: string; data: Omit<CatalogItem, "id" | "name" | "archived" | "createdAt" | "updatedAt">; archived: boolean; created_at: string; updated_at: string };
type DocRow = { id: string; kind: DocKind; number: string | null; state: DocState; content: DocContent; totals: Totals; payments: SalesDoc["payments"]; issued_at: string | null; created_at: string; updated_at: string };

const toClient = (r: ClientRow): Client => ({ ...r.data, id: r.id, name: r.name, archived: r.archived, createdAt: r.created_at, updatedAt: r.updated_at });
const toItem = (r: CatalogRow): CatalogItem => ({ ...r.data, id: r.id, name: r.name, archived: r.archived, createdAt: r.created_at, updatedAt: r.updated_at });
const toDoc = (r: DocRow): SalesDoc => ({
  id: r.id,
  kind: r.kind,
  number: r.number,
  state: r.state,
  content: r.content,
  totals: r.totals,
  payments: Array.isArray(r.payments) ? r.payments : [],
  issuedAt: r.issued_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

let probed: { value: boolean; until: number } | null = null;

export const supabaseSalesStore: SalesStore = {
  async supports() {
    if (probed && Date.now() < probed.until) return probed.value;
    const db = await createRlsClient();
    const probes = await Promise.all([
      db.from("lifeos_sales_docs").select("id, number, payments").limit(1),
      db.from("lifeos_clients").select("id").limit(1),
      db.from("lifeos_catalog").select("id").limit(1),
      db.from("lifeos_sales_issuer").select("user_key").limit(1),
    ]);
    const value = probes.every((p) => !p.error);
    probed = { value, until: value ? Number.POSITIVE_INFINITY : Date.now() + 60_000 };
    return value;
  },

  async getIssuer(userKey) {
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_sales_issuer").select("data").eq("user_key", userKey).maybeSingle();
    if (error) fail("issuer", error.message);
    return (data?.data as Issuer | undefined) ?? null;
  },
  async saveIssuer(userKey, issuer) {
    const db = await createRlsClient();
    const { error } = await db.from("lifeos_sales_issuer").upsert({ user_key: userKey, data: issuer, updated_at: new Date().toISOString() });
    if (error) fail("save issuer", error.message);
  },

  async listClients(userKey) {
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_clients").select("*").eq("user_key", userKey).order("name");
    if (error) fail("clients", error.message);
    return (data as ClientRow[]).map(toClient);
  },
  async getClient(userKey, id) {
    if (!UUID.test(id)) return null;
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_clients").select("*").eq("user_key", userKey).eq("id", id).maybeSingle();
    if (error) fail("client", error.message);
    return data ? toClient(data as ClientRow) : null;
  },
  async saveClient(userKey, id, input) {
    const db = await createRlsClient();
    const { name, ...rest } = input;
    if (id === null) {
      const { data, error } = await db.from("lifeos_clients").insert({ user_key: userKey, name, data: rest }).select("*").single();
      if (error) fail("create client", error.message);
      return toClient(data as ClientRow);
    }
    if (!UUID.test(id)) return null;
    const { data, error } = await db.from("lifeos_clients").update({ name, data: rest, updated_at: new Date().toISOString() }).eq("user_key", userKey).eq("id", id).select("*").maybeSingle();
    if (error) fail("save client", error.message);
    return data ? toClient(data as ClientRow) : null;
  },
  async setClientArchived(userKey, id, archived) {
    if (!UUID.test(id)) return false;
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_clients").update({ archived, updated_at: new Date().toISOString() }).eq("user_key", userKey).eq("id", id).select("id");
    if (error) fail("archive client", error.message);
    return (data ?? []).length > 0;
  },

  async listCatalog(userKey) {
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_catalog").select("*").eq("user_key", userKey).order("name");
    if (error) fail("catalog", error.message);
    return (data as CatalogRow[]).map(toItem);
  },
  async saveCatalogItem(userKey, id, input) {
    const db = await createRlsClient();
    const { name, ...rest } = input;
    if (id === null) {
      const { data, error } = await db.from("lifeos_catalog").insert({ user_key: userKey, name, data: rest }).select("*").single();
      if (error) fail("create item", error.message);
      return toItem(data as CatalogRow);
    }
    if (!UUID.test(id)) return null;
    const { data, error } = await db.from("lifeos_catalog").update({ name, data: rest, updated_at: new Date().toISOString() }).eq("user_key", userKey).eq("id", id).select("*").maybeSingle();
    if (error) fail("save item", error.message);
    return data ? toItem(data as CatalogRow) : null;
  },
  async setCatalogArchived(userKey, id, archived) {
    if (!UUID.test(id)) return false;
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_catalog").update({ archived, updated_at: new Date().toISOString() }).eq("user_key", userKey).eq("id", id).select("id");
    if (error) fail("archive item", error.message);
    return (data ?? []).length > 0;
  },

  async listDocs(userKey) {
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_sales_docs").select("*").eq("user_key", userKey).order("updated_at", { ascending: false });
    if (error) fail("documents", error.message);
    return (data as DocRow[]).map(toDoc);
  },
  async getDoc(userKey, id) {
    if (!UUID.test(id)) return null;
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_sales_docs").select("*").eq("user_key", userKey).eq("id", id).maybeSingle();
    if (error) fail("document", error.message);
    return data ? toDoc(data as DocRow) : null;
  },
  async createDraft(userKey, kind, content, totals) {
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_sales_docs").insert({ user_key: userKey, kind, content, totals }).select("*").single();
    if (error) fail("create draft", error.message);
    return toDoc(data as DocRow);
  },
  async saveDraft(userKey, id, content, totals) {
    const doc = await this.getDoc(userKey, id);
    if (!doc) return "missing";
    if (doc.number !== null) return "not_draft";
    const db = await createRlsClient();
    const { data, error } = await db
      .from("lifeos_sales_docs")
      .update({ content, totals, updated_at: new Date().toISOString() })
      .eq("user_key", userKey)
      .eq("id", id)
      .is("number", null)
      .select("*")
      .maybeSingle();
    if (error) fail("save draft", error.message);
    return data ? toDoc(data as DocRow) : "not_draft";
  },
  async deleteDraft(userKey, id) {
    const doc = await this.getDoc(userKey, id);
    if (!doc) return "missing";
    if (doc.number !== null) return "not_draft";
    const db = await createRlsClient();
    const { error } = await db.from("lifeos_sales_docs").delete().eq("user_key", userKey).eq("id", id).is("number", null);
    if (error) fail("delete draft", error.message);
    return true;
  },
  async issue(userKey, id, content, totals, year) {
    const doc = await this.getDoc(userKey, id);
    if (!doc) return "missing";
    if (doc.number !== null) return "not_draft";
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_issue_sales_doc", { p_id: id, p_content: content, p_totals: totals, p_year: year });
    if (error) {
      if (/Already issued/.test(error.message)) return "not_draft";
      fail("issue", error.message);
    }
    return toDoc(data as DocRow);
  },
  async setState(userKey, id, state) {
    if (!UUID.test(id)) return "missing";
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_sales_docs").update({ state, updated_at: new Date().toISOString() }).eq("user_key", userKey).eq("id", id).select("*").maybeSingle();
    if (error) fail("state", error.message);
    return data ? toDoc(data as DocRow) : "missing";
  },
  async setPayments(userKey, id, payments) {
    if (!UUID.test(id)) return "missing";
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_sales_docs").update({ payments, updated_at: new Date().toISOString() }).eq("user_key", userKey).eq("id", id).select("*").maybeSingle();
    if (error) fail("payments", error.message);
    return data ? toDoc(data as DocRow) : "missing";
  },

  async erase() {
    const db = await createRlsClient();
    const { error } = await db.rpc("lifeos_sales_erase");
    if (error) fail("erase", error.message);
  },
};
