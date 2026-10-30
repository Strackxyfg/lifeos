import { randomUUID } from "node:crypto";
import { jsonFile } from "./file";
import { formatNumber } from "./legal";
import type { CatalogItem, Client, Issuer, SalesDoc } from "./model";
import type { SalesStore } from "./store";

/** Sales without Supabase: `sales.json` in the local data folder, with the rules of `store.ts`. */

interface UserSales {
  issuer: Issuer | null;
  clients: Client[];
  catalog: CatalogItem[];
  docs: SalesDoc[];
  /** "invoice:2026" → the last number given in that series. */
  counters: Record<string, number>;
}

const file = jsonFile<Record<string, UserSales>>("sales.json", () => ({}));
const now = () => new Date().toISOString();
const mine = (d: Record<string, UserSales>, userKey: string): UserSales =>
  (d[userKey] ??= { issuer: null, clients: [], catalog: [], docs: [], counters: {} });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const localSalesStore: SalesStore = {
  async supports() {
    return true;
  },

  getIssuer: (userKey) => file.read((d) => copy(d[userKey]?.issuer ?? null)),
  async saveIssuer(userKey, issuer) {
    await file.mutate((d) => void (mine(d, userKey).issuer = copy(issuer)));
  },

  listClients: (userKey) => file.read((d) => copy(d[userKey]?.clients ?? []).sort((a, b) => a.name.localeCompare(b.name, "fr"))),
  getClient: (userKey, id) => file.read((d) => copy(d[userKey]?.clients.find((c) => c.id === id) ?? null)),
  saveClient: (userKey, id, input) =>
    file.mutate((d) => {
      const u = mine(d, userKey);
      if (id === null) {
        const c: Client = { ...copy(input), id: randomUUID(), archived: false, createdAt: now(), updatedAt: now() };
        u.clients.push(c);
        return copy(c);
      }
      const i = u.clients.findIndex((c) => c.id === id);
      if (i < 0) return null;
      u.clients[i] = { ...u.clients[i], ...copy(input), updatedAt: now() };
      return copy(u.clients[i]);
    }),
  setClientArchived: (userKey, id, archived) =>
    file.mutate((d) => {
      const c = mine(d, userKey).clients.find((x) => x.id === id);
      if (!c) return false;
      c.archived = archived;
      c.updatedAt = now();
      return true;
    }),

  listCatalog: (userKey) => file.read((d) => copy(d[userKey]?.catalog ?? []).sort((a, b) => a.name.localeCompare(b.name, "fr"))),
  saveCatalogItem: (userKey, id, input) =>
    file.mutate((d) => {
      const u = mine(d, userKey);
      if (id === null) {
        const item: CatalogItem = { ...copy(input), id: randomUUID(), archived: false, createdAt: now(), updatedAt: now() };
        u.catalog.push(item);
        return copy(item);
      }
      const i = u.catalog.findIndex((x) => x.id === id);
      if (i < 0) return null;
      u.catalog[i] = { ...u.catalog[i], ...copy(input), updatedAt: now() };
      return copy(u.catalog[i]);
    }),
  setCatalogArchived: (userKey, id, archived) =>
    file.mutate((d) => {
      const item = mine(d, userKey).catalog.find((x) => x.id === id);
      if (!item) return false;
      item.archived = archived;
      item.updatedAt = now();
      return true;
    }),

  listDocs: (userKey) => file.read((d) => copy(d[userKey]?.docs ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
  getDoc: (userKey, id) => file.read((d) => copy(d[userKey]?.docs.find((x) => x.id === id) ?? null)),
  createDraft: (userKey, kind, content, totals) =>
    file.mutate((d) => {
      const doc: SalesDoc = { id: randomUUID(), kind, number: null, state: "open", content: copy(content), totals: copy(totals), payments: [], issuedAt: null, createdAt: now(), updatedAt: now() };
      mine(d, userKey).docs.push(doc);
      return copy(doc);
    }),
  saveDraft: (userKey, id, content, totals) =>
    file.mutate((d) => {
      const doc = mine(d, userKey).docs.find((x) => x.id === id);
      if (!doc) return "missing" as const;
      if (doc.number !== null) return "not_draft" as const;
      Object.assign(doc, { content: copy(content), totals: copy(totals), updatedAt: now() });
      return copy(doc);
    }),
  deleteDraft: (userKey, id) =>
    file.mutate((d) => {
      const u = mine(d, userKey);
      const doc = u.docs.find((x) => x.id === id);
      if (!doc) return "missing" as const;
      if (doc.number !== null) return "not_draft" as const;
      u.docs = u.docs.filter((x) => x.id !== id);
      return true as const;
    }),
  issue: (userKey, id, content, totals, year) =>
    file.mutate((d) => {
      const u = mine(d, userKey);
      const doc = u.docs.find((x) => x.id === id);
      if (!doc) return "missing" as const;
      if (doc.number !== null) return "not_draft" as const;
      const series = `${doc.kind}:${year}`;
      const seq = (u.counters[series] ?? 0) + 1;
      u.counters[series] = seq;
      Object.assign(doc, { number: formatNumber(doc.kind, year, seq), content: copy(content), totals: copy(totals), issuedAt: now(), updatedAt: now() });
      return copy(doc);
    }),
  setState: (userKey, id, state) =>
    file.mutate((d) => {
      const doc = mine(d, userKey).docs.find((x) => x.id === id);
      if (!doc) return "missing" as const;
      Object.assign(doc, { state, updatedAt: now() });
      return copy(doc);
    }),
  setPayments: (userKey, id, payments) =>
    file.mutate((d) => {
      const doc = mine(d, userKey).docs.find((x) => x.id === id);
      if (!doc) return "missing" as const;
      Object.assign(doc, { payments: copy(payments), updatedAt: now() });
      return copy(doc);
    }),

  async erase(userKey) {
    await file.mutate((d) => {
      const u = d[userKey];
      if (u) d[userKey] = { issuer: null, clients: [], catalog: [], docs: [], counters: u.counters };
    });
  },
};
