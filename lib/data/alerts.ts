import { loadSnapshot } from "./live";
import { fill } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/dictionaries";

export type AlertLevel = "danger" | "warning" | "info";

export interface Alert {
  id: string;
  level: AlertLevel;
  text: string;
  href: string;
}

/** Derives real, localized alerts from the persisted workspace. */
export async function buildAlerts(m: Messages): Promise<Alert[]> {
  const s = await loadSnapshot();
  const n = m.notifications;
  const alerts: Alert[] = [];

  for (const name of s.projects.blockedNames) {
    alerts.push({
      id: `blocked-${name}`,
      level: "danger",
      text: fill(n.blocked, { name }),
      href: "/projects",
    });
  }

  const weakest = s.projects.dueSoon[0];
  if (weakest && weakest.progress < 30) {
    alerts.push({
      id: `low-${weakest.name}`,
      level: "warning",
      text: fill(n.lowProgress, { name: weakest.name, progress: weakest.progress, due: weakest.due }),
      href: "/projects",
    });
  }

  if (s.tasks.open > 0) {
    alerts.push({
      id: "tasks-open",
      level: "info",
      text: fill(n.tasksOpen, { count: s.tasks.open }),
      href: "/dashboard",
    });
  }

  const deal = s.crm.nextActions[0];
  if (deal) {
    alerts.push({ id: "deal", level: "info", text: fill(n.deal, { text: deal }), href: "/crm" });
  }

  return alerts;
}
