import "server-only";
import { cache } from "react";
import { getStore, getUserKey } from "@/lib/db/store";
import { computeSnapshot, type WorkspaceSnapshot } from "./workspace";
import type { Dataset, DbBrainDismissal, DbBrainLink } from "@/lib/db/types";
import { isMissingTable } from "@/lib/db/errors";

export { isMissingTable };

/**
 * The second brain's links, or an explicit "not available yet".
 *
 * Separate from `loadWorkspace` and deliberately tolerant: the layout reads the
 * workspace on every page, so a missing links table must not be able to break
 * pages that have nothing to do with links. Any *other* error still throws —
 * degrading silently on a real failure is how data goes missing unnoticed.
 */
export const loadLinks = cache(async function loadLinks(): Promise<{
  links: DbBrainLink[];
  available: boolean;
}> {
  try {
    const links = await getStore().list(await getUserKey(), "links");
    return { links, available: true };
  } catch (err) {
    if (isMissingTable(err)) return { links: [], available: false };
    throw err;
  }
});

/**
 * Pairs the person said are not related (migration 008). Tolerant for the
 * same reason as links: before the migration there is simply nothing to
 * remember, and every page must still render.
 */
export const loadDismissals = cache(async function loadDismissals(): Promise<DbBrainDismissal[]> {
  try {
    return await getStore().list(await getUserKey(), "dismissals");
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
});

/**
 * Reads the signed-in user's whole workspace in one pass.
 *
 * `cache()` matters here: the layout (for alerts) and the page both need the
 * workspace, and without memoisation that was ten table queries per render
 * instead of five.
 */
export const loadWorkspace = cache(async function loadWorkspace(): Promise<Dataset> {
  const store = getStore();
  const userKey = await getUserKey();
  const [projects, deals, transactions, tasks, brain, { links }, dismissals] = await Promise.all([
    store.list(userKey, "projects"),
    store.list(userKey, "deals"),
    store.list(userKey, "transactions"),
    store.list(userKey, "tasks"),
    store.list(userKey, "brain"),
    loadLinks(),
    loadDismissals(),
  ]);
  return { projects, deals, transactions, tasks, brain, links, dismissals };
});

/** Single collection. Served from the cached full read to avoid a second query. */
export async function loadCollection<C extends keyof Dataset>(collection: C): Promise<Dataset[C]> {
  const data = await loadWorkspace();
  return data[collection];
}

/** The snapshot the AI reasons over — computed from persisted rows. */
export const loadSnapshot = cache(async function loadSnapshot(): Promise<WorkspaceSnapshot> {
  return computeSnapshot(await loadWorkspace());
});
