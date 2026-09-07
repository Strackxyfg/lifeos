/**
 * Shared demo dataset for the app surfaces.
 * In production these are Notion-backed reads; the shape mirrors the
 * generated database blueprints so swapping to live data is a fetch change.
 */

export type ProjectStatus = "Planning" | "In progress" | "Blocked" | "Done";
export const projectStatuses: ProjectStatus[] = ["Planning", "In progress", "Blocked", "Done"];

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  owner: string;
  due: string;
  progress: number;
  priority: "Low" | "Medium" | "High";
}

export const projects: Project[] = [
  { id: "p1", name: "Onboarding v2", status: "In progress", owner: "Quinn", due: "Jul 28", progress: 80, priority: "High" },
  { id: "p2", name: "Pricing experiment", status: "Planning", owner: "Maya", due: "Aug 04", progress: 20, priority: "Medium" },
  { id: "p3", name: "Notion API hardening", status: "In progress", owner: "Dan", due: "Jul 31", progress: 55, priority: "High" },
  { id: "p4", name: "Investor deck", status: "Blocked", owner: "Quinn", due: "Jul 26", progress: 35, priority: "High" },
  { id: "p5", name: "Launch page", status: "Done", owner: "Priya", due: "Jul 20", progress: 100, priority: "Medium" },
  { id: "p6", name: "SEO template hub", status: "Planning", owner: "Maya", due: "Aug 12", progress: 10, priority: "Low" },
  { id: "p7", name: "Weekly review automation", status: "In progress", owner: "Dan", due: "Aug 02", progress: 60, priority: "Medium" },
];

export type DealStage = "Lead" | "Qualified" | "Proposal" | "Won" | "Lost";
export const dealStages: DealStage[] = ["Lead", "Qualified", "Proposal", "Won"];

export interface Deal {
  id: string;
  name: string;
  company: string;
  stage: DealStage;
  value: number;
  owner: string;
  next: string;
}

export const deals: Deal[] = [
  { id: "d1", name: "Northwind rollout", company: "Northwind", stage: "Lead", value: 12000, owner: "Quinn", next: "Intro call" },
  { id: "d2", name: "Acme seats", company: "Acme Co", stage: "Lead", value: 8000, owner: "Maya", next: "Send deck" },
  { id: "d3", name: "Globex pilot", company: "Globex", stage: "Qualified", value: 24000, owner: "Quinn", next: "Scope call" },
  { id: "d4", name: "Umbrella expansion", company: "Umbrella", stage: "Proposal", value: 42000, owner: "Dan", next: "Redline MSA" },
  { id: "d5", name: "Initech renewal", company: "Initech", stage: "Won", value: 36000, owner: "Maya", next: "Kickoff" },
  { id: "d6", name: "Soylent trial", company: "Soylent", stage: "Won", value: 18000, owner: "Quinn", next: "Onboard" },
];

export type TxnType = "Income" | "Expense";
export interface Transaction {
  id: string;
  item: string;
  type: TxnType;
  amount: number;
  category: string;
  date: string;
}

export const transactions: Transaction[] = [
  { id: "t1", item: "Pro subscriptions", type: "Income", amount: 18420, category: "Revenue", date: "Jul 22" },
  { id: "t2", item: "Founder plan — Acme", type: "Income", amount: 5760, category: "Revenue", date: "Jul 19" },
  { id: "t3", item: "Payroll", type: "Expense", amount: 9800, category: "Payroll", date: "Jul 15" },
  { id: "t4", item: "Vercel + Supabase", type: "Expense", amount: 640, category: "Tools", date: "Jul 12" },
  { id: "t5", item: "Ad spend — launch", type: "Expense", amount: 3200, category: "Marketing", date: "Jul 10" },
  { id: "t6", item: "OpenAI usage", type: "Expense", amount: 1180, category: "Tools", date: "Jul 08" },
  { id: "t7", item: "Consulting — Q3", type: "Income", amount: 4000, category: "Revenue", date: "Jul 05" },
];

export function financeSummary(txns: Transaction[] = transactions) {
  const income = txns.filter((t) => t.type === "Income").reduce((s, t) => s + t.amount, 0);
  const expense = txns.filter((t) => t.type === "Expense").reduce((s, t) => s + t.amount, 0);
  return { income, expense, net: income - expense };
}

/** Today's tasks — text lives in i18n (`dashboard.tasks[id]`). */
export interface TodayTask {
  id: string;
  done: boolean;
}

export const todayTasks: TodayTask[] = [
  { id: "d1", done: true },
  { id: "d2", done: false },
  { id: "d3", done: false },
  { id: "d4", done: false },
];

export const habitStreak = 23;

/**
 * A numeric snapshot of the workspace.
 * This is what the AI reasons over — so reviews cite real figures instead of
 * inventing them, and the no-key fallback stays factually correct.
 */
export interface WorkspaceSnapshot {
  projects: {
    total: number;
    inProgress: number;
    blocked: number;
    done: number;
    planning: number;
    avgProgress: number;
    blockedNames: string[];
    dueSoon: { name: string; due: string; progress: number }[];
  };
  finance: { income: number; expense: number; net: number; topExpense: string };
  crm: { openValue: number; wonValue: number; openCount: number; nextActions: string[] };
  tasks: { total: number; done: number; open: number };
  habitStreak: number;
}

/** Shapes the snapshot needs — satisfied by both seed data and DB rows. */
export interface SnapshotInput {
  projects: Pick<Project, "name" | "status" | "progress" | "due">[];
  deals: Pick<Deal, "stage" | "value" | "company" | "next">[];
  transactions: Pick<Transaction, "type" | "amount" | "category">[];
  tasks: { done: boolean }[];
}

/** Pure aggregation — no I/O, so it stays fast and unit-testable. */
export function computeSnapshot(input: SnapshotInput): WorkspaceSnapshot {
  const { projects, deals, transactions, tasks } = input;

  const blocked = projects.filter((p) => p.status === "Blocked");
  const done = projects.filter((p) => p.status === "Done");
  const inProgress = projects.filter((p) => p.status === "In progress");
  const planning = projects.filter((p) => p.status === "Planning");
  const avgProgress = Math.round(
    projects.reduce((s, p) => s + p.progress, 0) / Math.max(projects.length, 1)
  );

  const income = transactions.filter((t) => t.type === "Income").reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter((t) => t.type === "Expense").reduce((s, t) => s + t.amount, 0);
  const net = income - expense;
  const expenseByCat = transactions
    .filter((t) => t.type === "Expense")
    .reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount;
      return acc;
    }, {});
  const topExpense =
    Object.entries(expenseByCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const open = deals.filter((d) => d.stage !== "Won" && d.stage !== "Lost");

  return {
    projects: {
      total: projects.length,
      inProgress: inProgress.length,
      blocked: blocked.length,
      done: done.length,
      planning: planning.length,
      avgProgress,
      blockedNames: blocked.map((p) => p.name),
      dueSoon: [...projects]
        .filter((p) => p.status !== "Done")
        .sort((a, b) => a.progress - b.progress)
        .slice(0, 3)
        .map((p) => ({ name: p.name, due: p.due, progress: p.progress })),
    },
    finance: { income, expense, net, topExpense },
    crm: {
      openValue: open.reduce((s, d) => s + d.value, 0),
      wonValue: deals.filter((d) => d.stage === "Won").reduce((s, d) => s + d.value, 0),
      openCount: open.length,
      nextActions: open.slice(0, 3).map((d) => `${d.company}: ${d.next}`),
    },
    tasks: {
      total: tasks.length,
      done: tasks.filter((t) => t.done).length,
      open: tasks.filter((t) => !t.done).length,
    },
    habitStreak,
  };
}

/** Convenience overload used by tests and the seed preview. */
export function buildSnapshot(): WorkspaceSnapshot {
  return computeSnapshot({ projects, deals, transactions, tasks: todayTasks });
}

export const statusColor: Record<ProjectStatus, string> = {
  Planning: "text-warning bg-warning/10",
  "In progress": "text-accent bg-accent/10",
  Blocked: "text-danger bg-danger/10",
  Done: "text-success bg-success/10",
};

export const priorityColor: Record<Project["priority"], string> = {
  High: "text-danger",
  Medium: "text-warning",
  Low: "text-muted-foreground",
};
