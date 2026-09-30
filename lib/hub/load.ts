import "server-only";
import { loadReminders, loadWorkspace } from "@/lib/data/live";
import { reminderCounts } from "@/lib/reminders/client";
import { computeSnapshot } from "@/lib/data/workspace";
import { loadBrainView } from "@/lib/brain/load";
import { brainDigest } from "@/lib/brain/digest";
import { openTensions } from "@/lib/brain/graph";
import { getStore, getUserKey } from "@/lib/db/store";
import { teamWaiting } from "@/lib/team/load";
import type { Messages } from "@/lib/i18n/dictionaries";
import type { HubFacts } from "./summary";
import { loadSelfData } from "@/lib/self/store";
import { portraitOf } from "@/lib/self/portrait";

/**
 * The island's figures for the signed-in person, from the same loaders the
 * pages use — so the hub never says something the page behind the door
 * contradicts.
 */
export async function loadHubFacts(m: Messages, now = new Date()): Promise<HubFacts> {
  const [view, data, memory, { reminders, available }, team, self] = await Promise.all([
    loadBrainView(m),
    loadWorkspace(),
    getStore().supportsMemory(),
    loadReminders(),
    // The island must render even if the teams' tables are unreachable.
    getUserKey().then((k) => teamWaiting(k, now)).catch(() => null),
    getUserKey().then((k) => loadSelfData(getStore(), k)),
  ]);
  // Counted as the portrait shows them: a proposal whose quotes are gone is not waiting for anything.
  const portrait = portraitOf(self.traits, view.notes);
  const toConfirm = Object.values(portrait).reduce((n, list) => n + list.filter((t) => t.status === "proposed").length, 0);
  const digest = brainDigest({ notes: view.notes, links: view.links, now, memory });
  const snap = computeSnapshot(data);
  return {
    notes: view.notes.length,
    links: view.links.length,
    reviewDue: digest.dueForReview,
    tensions: openTensions(view.links).length,
    unreviewed: digest.awaitingReview,
    toConfirm,
    tasksOpen: snap.tasks.open,
    tasksDone: snap.tasks.done,
    reminders: available ? reminderCounts(reminders, now) : null,
    projects: {
      active: snap.projects.total - snap.projects.done,
      blocked: snap.projects.blocked,
      avgProgress: snap.projects.avgProgress,
    },
    deals: { open: snap.crm.openCount, openValue: snap.crm.openValue },
    finance: { income: snap.finance.income, expense: snap.finance.expense, net: snap.finance.net },
    team,
  };
}
