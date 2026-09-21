import "server-only";
import { loadCollection, loadLinks } from "@/lib/data/live";
import { isCategory, kindForCategory } from "@/lib/data/brain";
import { liveLinks, type BrainNote } from "./graph";
import type { DbBrainItem, DbBrainLink } from "@/lib/db/types";
import type { Messages } from "@/lib/i18n/dictionaries";

/**
 * The second brain, ready to show: every note with its text resolved, and only
 * the links whose two ends still exist.
 *
 * One loader for the page and the export, so what you see is exactly what you
 * download.
 */
export interface BrainView {
  notes: BrainNote[];
  links: DbBrainLink[];
  /** False until migration 007 creates the links table. */
  linksAvailable: boolean;
}

/** Demo notes carry an i18n key instead of text; real notes carry their own. */
function resolve(item: DbBrainItem, m: Messages): { title: string; detail: string | null } {
  if (item.title) return { title: item.title, detail: item.detail };
  const seeded = item.seedKey ? m.brain.items[item.seedKey] : undefined;
  return { title: seeded?.title ?? "", detail: item.detail ?? seeded?.detail ?? null };
}

export function toBrainNotes(items: DbBrainItem[], m: Messages): BrainNote[] {
  return items.map((item) => {
    // A region that no longer exists (older data, a hand-edited row) lands in
    // Thoughts rather than vanishing from the brain.
    const category = isCategory(item.category) ? item.category : "thoughts";
    const { title, detail } = resolve(item, m);
    return {
      id: item.id,
      category,
      kind: item.kind ?? kindForCategory[category],
      title: title.trim() || "—",
      detail,
      done: item.done,
      ai: item.ai,
      createdAt: item.createdAt,
    };
  });
}

export async function loadBrainView(m: Messages): Promise<BrainView> {
  const [items, { links, available }] = await Promise.all([loadCollection("brain"), loadLinks()]);
  const notes = toBrainNotes(items, m);
  return { notes, links: liveLinks(links, notes), linksAvailable: available };
}
