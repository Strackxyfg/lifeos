import "server-only";
import { getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import type { Collection, Dataset, DbProfile } from "@/lib/db/types";
import { getTeamStore } from "@/lib/team/store";
import type { AuthoredTeamData } from "@/lib/team/types";
import { getMapStore } from "@/lib/maps/store";
import type { MapDoc } from "@/lib/maps/model";
import { getSalesStore } from "@/lib/sales/store";
import type { CatalogItem, Client, Issuer, SalesDoc } from "@/lib/sales/model";

/**
 * Everything a person keeps in LifeOS besides their brain — for the export
 * that says "everything": their profile, projects, deals, transactions,
 * tasks, reminders, balances and weekly reviews, their double (portrait,
 * check-ins, what they did with its advice), their mind maps, their sales
 * (the business, clients, catalogue, every quote, invoice and credit note,
 * issued ones exactly as issued), and what they wrote in their teams. Rows lose the account key (it is theirs, and says nothing).
 * A table a pending migration has not created yet is simply empty; any
 * other failure fails the export rather than handing over less than it
 * claims.
 */

const COLLECTIONS = ["projects", "deals", "transactions", "tasks", "reminders", "balances", "reviews", "traits", "checkins", "advice"] as const satisfies readonly Collection[];
type Exported = (typeof COLLECTIONS)[number];

export interface WorkspaceExport {
  profile: Omit<DbProfile, "userKey"> | null;
  collections: { [C in Exported]: Omit<Dataset[C][number], "userKey">[] };
  teams: AuthoredTeamData["teams"];
  /** Mind maps, whole (images are files of their own in the archive). */
  maps: { id: string; title: string; createdAt: string; updatedAt: string; doc: MapDoc }[];
  /** Sales (migration 017): what an accountant, or the tax office, may ask to see. */
  sales: { issuer: Issuer | null; clients: Client[]; catalog: CatalogItem[]; documents: SalesDoc[] };
}

const withoutKey = <T extends { userKey?: string }>(row: T): Omit<T, "userKey"> => {
  const { userKey: _k, ...rest } = row;
  return rest;
};

async function tolerant<T>(load: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (isMissingTable(err)) return empty;
    throw err;
  }
}

export async function loadWorkspaceExport(userKey: string): Promise<WorkspaceExport> {
  const store = getStore();
  const teamStore = getTeamStore();
  const [profile, lists, teams, maps, sales] = await Promise.all([
    tolerant(() => store.getProfile(userKey), null),
    Promise.all(COLLECTIONS.map((c) => tolerant(() => store.list(userKey, c) as Promise<{ userKey?: string }[]>, []))),
    tolerant(async () => ((await teamStore.supportsTeams()) ? (await teamStore.authoredBy(userKey)).teams : []), [] as AuthoredTeamData["teams"]),
    loadMaps(userKey),
    loadSales(userKey),
  ]);
  const collections = Object.fromEntries(COLLECTIONS.map((c, i) => [c, lists[i].map(withoutKey)])) as WorkspaceExport["collections"];
  return { profile: profile ? withoutKey(profile) : null, collections, teams, maps, sales };
}

async function loadSales(userKey: string): Promise<WorkspaceExport["sales"]> {
  const store = getSalesStore();
  if (!(await store.supports())) return { issuer: null, clients: [], catalog: [], documents: [] };
  const [issuer, clients, catalog, documents] = await Promise.all([store.getIssuer(userKey), store.listClients(userKey), store.listCatalog(userKey), store.listDocs(userKey)]);
  return { issuer, clients, catalog, documents };
}

/** Every mind map, one at a time (a map is up to a few megabytes). */
async function loadMaps(userKey: string): Promise<WorkspaceExport["maps"]> {
  const store = getMapStore();
  if (!(await store.supports())) return [];
  const out: WorkspaceExport["maps"] = [];
  for (const meta of await store.list(userKey)) {
    const map = await store.get(userKey, meta.id);
    if (map) out.push({ id: map.id, title: map.title, createdAt: map.createdAt, updatedAt: map.updatedAt, doc: map.doc });
  }
  return out;
}
