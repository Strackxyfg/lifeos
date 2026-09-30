import type { DistrictId } from "./districts";

/**
 * What the island shows about each part of LifeOS: real counts, read from the
 * person's own data, never an estimate. A building says "3" only when three
 * things actually wait there.
 */
export interface HubFacts {
  notes: number;
  links: number;
  /** Notes due for spaced review today. */
  reviewDue: number;
  /** Contradictions still waiting for a decision. */
  tensions: number;
  /** Connections the engine proposed, not yet looked at. */
  unreviewed: number;
  /** Observations the double proposed about the person, waiting for their word (migration 015). */
  toConfirm: number;
  tasksOpen: number;
  tasksDone: number;
  /** Null until reminders are available (migration 011). */
  reminders: { overdue: number; today: number; next: { title: string; dueAt: string } | null } | null;
  projects: { active: number; blocked: number; avgProgress: number };
  deals: { open: number; openValue: number };
  finance: { income: number; expense: number; net: number };
  /** Null when the person belongs to no team (or teams are not available yet). */
  team: { name: string; members: number; waiting: number } | null;
}

/** The count a building's marker carries: what asks for attention there. */
export function hubBadges(f: HubFacts): Partial<Record<DistrictId, number>> {
  return {
    brain: f.reviewDue + f.tensions + f.toConfirm,
    today: f.reminders ? f.reminders.overdue + f.reminders.today : 0,
    projects: f.projects.blocked,
    team: f.team?.waiting ?? 0,
  };
}

export type StatFormat = "count" | "money" | "percent";

export interface HubStat {
  /** A key of `messages.hub.stats`. */
  key:
    | "notes"
    | "links"
    | "reviewDue"
    | "tensions"
    | "unreviewed"
    | "toConfirm"
    | "tasksOpen"
    | "tasksDone"
    | "remindersOverdue"
    | "remindersToday"
    | "projectsActive"
    | "projectsBlocked"
    | "avgProgress"
    | "dealsOpen"
    | "pipeline"
    | "income"
    | "expense"
    | "net"
    | "members";
  value: number;
  format: StatFormat;
  /** Something that asks for attention, shown in the accent colour. */
  alert?: boolean;
}

/**
 * The figures a building's panel shows — at most four, the ones that say
 * most about that part of the person's work. Empty for the buildings whose
 * content is not a number (the assistant, the agent, the settings).
 */
export function hubStats(id: DistrictId, f: HubFacts): HubStat[] {
  switch (id) {
    case "brain":
      return [
        { key: "notes", value: f.notes, format: "count" },
        // What the double waits to hear from them, when it waits — else the connections.
        f.toConfirm > 0 ? { key: "toConfirm", value: f.toConfirm, format: "count", alert: true } : { key: "links", value: f.links, format: "count" },
        { key: "reviewDue", value: f.reviewDue, format: "count", alert: f.reviewDue > 0 },
        { key: "tensions", value: f.tensions, format: "count", alert: f.tensions > 0 },
      ];
    case "today": {
      const out: HubStat[] = [];
      if (f.reminders) {
        out.push({ key: "remindersOverdue", value: f.reminders.overdue, format: "count", alert: f.reminders.overdue > 0 });
        out.push({ key: "remindersToday", value: f.reminders.today, format: "count" });
      }
      out.push({ key: "tasksOpen", value: f.tasksOpen, format: "count" });
      out.push({ key: "tasksDone", value: f.tasksDone, format: "count" });
      return out;
    }
    case "projects":
      return [
        { key: "projectsActive", value: f.projects.active, format: "count" },
        { key: "projectsBlocked", value: f.projects.blocked, format: "count", alert: f.projects.blocked > 0 },
        { key: "avgProgress", value: f.projects.avgProgress, format: "percent" },
      ];
    case "relations":
      return [
        { key: "dealsOpen", value: f.deals.open, format: "count" },
        { key: "pipeline", value: f.deals.openValue, format: "money" },
      ];
    case "finance":
      return [
        { key: "income", value: f.finance.income, format: "money" },
        { key: "expense", value: f.finance.expense, format: "money" },
        { key: "net", value: f.finance.net, format: "money", alert: f.finance.net < 0 },
      ];
    case "team":
      return f.team ? [{ key: "members", value: f.team.members, format: "count" }] : [];
    case "assistant":
      // What it answers from.
      return [{ key: "notes", value: f.notes, format: "count" }];
    case "agent":
    case "settings":
      return [];
  }
}
