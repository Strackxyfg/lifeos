import "server-only";
import { loadCollection, loadDismissals, loadLinks } from "@/lib/data/live";
import { isCategory, kindForCategory } from "@/lib/data/brain";
import { liveLinks, pairKey, toBrainLink, type BrainLink, type BrainNote } from "./graph";
import { sanitizeConcepts } from "./concepts";
import type { DbBrainItem } from "@/lib/db/types";
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
  links: BrainLink[];
  /** False until migration 007 creates the links table. */
  linksAvailable: boolean;
  /** Pairs the person said are not related, as `pairKey`s. */
  dismissed: string[];
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
      // Stored JSON, so validated on the way out like any other input.
      concepts: sanitizeConcepts(item.concepts),
    };
  });
}

export async function loadBrainView(m: Messages): Promise<BrainView> {
  const [items, { links, available }, dismissals] = await Promise.all([
    loadCollection("brain"),
    loadLinks(),
    loadDismissals(),
  ]);
  const notes = toBrainNotes(items, m);
  return {
    notes,
    links: liveLinks(links.map(toBrainLink), notes),
    linksAvailable: available,
    dismissed: dismissals.map((d) => pairKey(d.fromId, d.toId)),
  };
}
