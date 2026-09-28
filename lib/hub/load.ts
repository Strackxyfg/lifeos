import "server-only";
import { loadWorkspace } from "@/lib/data/live";
import { computeSnapshot } from "@/lib/data/workspace";
import { loadBrainView } from "@/lib/brain/load";
import { brainDigest } from "@/lib/brain/digest";
import { openTensions } from "@/lib/brain/graph";
import { getStore } from "@/lib/db/store";
import type { Messages } from "@/lib/i18n/dictionaries";
import type { HubFacts } from "./summary";

/**
 * The island's figures for the signed-in person, from the same loaders the
 * pages use — so the hub never says something the page behind the door
 * contradicts.
 */
export async function loadHubFacts(m: Messages, now = new Date()): Promise<HubFacts> {
  const [view, data, memory] = await Promise.all([loadBrainView(m), loadWorkspace(), getStore().supportsMemory()]);
  const digest = brainDigest({ notes: view.notes, links: view.links, now, memory });
  const snap = computeSnapshot(data);
  return {
    notes: view.notes.length,
    links: view.links.length,
    reviewDue: digest.dueForReview,
    tensions: openTensions(view.links).length,
    unreviewed: digest.awaitingReview,
    tasksOpen: snap.tasks.open,
    tasksDone: snap.tasks.done,
    reminders: null,
    projects: {
      active: snap.projects.total - snap.projects.done,
      blocked: snap.projects.blocked,
      avgProgress: snap.projects.avgProgress,
    },
    deals: { open: snap.crm.openCount, openValue: snap.crm.openValue },
    finance: { income: snap.finance.income, expense: snap.finance.expense, net: snap.finance.net },
    team: null,
  };
}
