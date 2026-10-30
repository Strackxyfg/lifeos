import "server-only";
import { isSupabaseConfigured } from "@/lib/db/store";
import type { Payment, Totals } from "./compute";
import type { CatalogItem, Client, DocContent, DocKind, DocState, Issuer, SalesDoc } from "./model";
import { localSalesStore } from "./store-local";
import { supabaseSalesStore } from "./store-supabase";

/**
 * Where sales live: the database when Supabase is configured (migration
 * 017), the local data folder otherwise — one contract, the same rules:
 *
 *  - a number is given only by `issue`, the next of its series (kind and
 *    year), allocated atomically: never shared, never skipped;
 *  - an issued document's content, totals and number never change, and it
 *    is never deleted — only its state and its payments move;
 *  - `erase` (the person erasing their account) removes the documents too,
 *    but the numbering continues where it was.
 */

export type ClientInput = Omit<Client, "id" | "archived" | "createdAt" | "updatedAt">;
export type CatalogInput = Omit<CatalogItem, "id" | "archived" | "createdAt" | "updatedAt">;

/** What a write on a document can meet besides success. */
export type DocRefusal = "missing" | "not_draft";

export interface SalesStore {
  supports(): Promise<boolean>;

  getIssuer(userKey: string): Promise<Issuer | null>;
  saveIssuer(userKey: string, issuer: Issuer): Promise<void>;

  listClients(userKey: string): Promise<Client[]>;
  getClient(userKey: string, id: string): Promise<Client | null>;
  saveClient(userKey: string, id: string | null, input: ClientInput): Promise<Client | null>;
  setClientArchived(userKey: string, id: string, archived: boolean): Promise<boolean>;

  listCatalog(userKey: string): Promise<CatalogItem[]>;
  saveCatalogItem(userKey: string, id: string | null, input: CatalogInput): Promise<CatalogItem | null>;
  setCatalogArchived(userKey: string, id: string, archived: boolean): Promise<boolean>;

  listDocs(userKey: string): Promise<SalesDoc[]>;
  getDoc(userKey: string, id: string): Promise<SalesDoc | null>;
  createDraft(userKey: string, kind: DocKind, content: DocContent, totals: Totals): Promise<SalesDoc>;
  saveDraft(userKey: string, id: string, content: DocContent, totals: Totals): Promise<SalesDoc | DocRefusal>;
  deleteDraft(userKey: string, id: string): Promise<true | DocRefusal>;
  issue(userKey: string, id: string, content: DocContent, totals: Totals, year: number): Promise<SalesDoc | DocRefusal>;
  setState(userKey: string, id: string, state: DocState): Promise<SalesDoc | "missing">;
  setPayments(userKey: string, id: string, payments: Payment[]): Promise<SalesDoc | "missing">;

  erase(userKey: string): Promise<void>;
}

export function getSalesStore(): SalesStore {
  return isSupabaseConfigured() ? supabaseSalesStore : localSalesStore;
}
