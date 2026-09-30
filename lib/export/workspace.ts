import "server-only";
import { getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import type { Collection, Dataset, DbProfile } from "@/lib/db/types";
import { getTeamStore } from "@/lib/team/store";
import type { AuthoredTeamData } from "@/lib/team/types";

/**
 * Everything a person keeps in LifeOS besides their brain — for the export
 * that says "everything": their profile, projects, deals, transactions,
 * tasks, reminders, balances and weekly reviews, their double (portrait,
 * check-ins, what they did with its advice), and what they wrote in their
 * teams. Rows lose the account key (it is theirs, and says nothing).
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
  const [profile, lists, teams] = await Promise.all([
    tolerant(() => store.getProfile(userKey), null),
    Promise.all(COLLECTIONS.map((c) => tolerant(() => store.list(userKey, c) as Promise<{ userKey?: string }[]>, []))),
    tolerant(async () => ((await teamStore.supportsTeams()) ? (await teamStore.authoredBy(userKey)).teams : []), [] as AuthoredTeamData["teams"]),
  ]);
  const collections = Object.fromEntries(COLLECTIONS.map((c, i) => [c, lists[i].map(withoutKey)])) as WorkspaceExport["collections"];
  return { profile: profile ? withoutKey(profile) : null, collections, teams };
}
