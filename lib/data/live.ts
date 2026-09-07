import "server-only";
import { cache } from "react";
import { getStore, getUserKey } from "@/lib/db/store";
import { computeSnapshot, type WorkspaceSnapshot } from "./workspace";
import type { Dataset } from "@/lib/db/types";

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
  const [projects, deals, transactions, tasks, brain] = await Promise.all([
    store.list(userKey, "projects"),
    store.list(userKey, "deals"),
    store.list(userKey, "transactions"),
    store.list(userKey, "tasks"),
    store.list(userKey, "brain"),
  ]);
  return { projects, deals, transactions, tasks, brain };
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
