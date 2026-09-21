import { projects, deals, transactions, todayTasks } from "@/lib/data/workspace";
import { seedItems } from "@/lib/data/brain";
import type { Dataset } from "./types";

/** Signed-out preview identity. The only key that gets demo content. */
export const DEMO_USER_KEY = "demo@lifeos.ai";

/**
 * Whether a workspace should be pre-filled with demo content.
 *
 * Only the signed-out preview identity gets it. A real account starts **empty**:
 * showing someone "Maya Chen" and "Northwind" as if they were their own
 * contacts is misleading, and it hides whether generation actually worked.
 */
export function shouldSeed(userKey: string): boolean {
  return userKey === DEMO_USER_KEY;
}

/**
 * Demo dataset for the signed-out preview.
 * Seeded rows keep their i18n key (`labelKey` / `seedKey`) so their text still
 * follows the locale; user-created rows carry literal text instead.
 */
export function seedDataset(userKey: string): Dataset {
  // Staggered by index so `order by created_at desc` reproduces array order
  // instead of an arbitrary shuffle of identical timestamps.
  const base = Date.now();
  const now = (i = 0) => new Date(base - i * 1000).toISOString();
  const id = (prefix: string, i: number) => `${prefix}_${i}`;

  return {
    projects: projects.map((p, i) => ({
      id: id("prj", i),
      userKey,
      createdAt: now(i),
      name: p.name,
      status: p.status,
      owner: p.owner,
      due: p.due,
      progress: p.progress,
      priority: p.priority,
    })),
    deals: deals.map((d, i) => ({
      id: id("deal", i),
      userKey,
      createdAt: now(i),
      name: d.name,
      company: d.company,
      stage: d.stage,
      value: d.value,
      owner: d.owner,
      next: d.next,
    })),
    transactions: transactions.map((t, i) => ({
      id: id("txn", i),
      userKey,
      createdAt: now(i),
      item: t.item,
      type: t.type,
      amount: t.amount,
      category: t.category,
      date: t.date,
    })),
    tasks: todayTasks.map((t, i) => ({
      id: id("task", i),
      userKey,
      createdAt: now(i),
      labelKey: t.id,
      label: null,
      done: t.done,
    })),
    brain: seedItems.map((b, i) => ({
      id: id("brain", i),
      userKey,
      // Backdated by each item's `ts`, so the demo has a history: without it
      // every sample note is minutes old and resurfacing — which only brings
      // back notes a week or older — would never have anything to show.
      createdAt: new Date(base - ageOf(b.ts) - i * 1000).toISOString(),
      category: b.category,
      kind: b.kind,
      seedKey: b.id,
      title: null,
      detail: null,
      done: b.done ?? false,
      ai: b.ai ?? false,
    })),
    // Links can't be seeded: in Supabase the sample notes get fresh UUIDs on
    // insert, which a separate seed pass for links has no way to know.
    links: [],
  };
}

/** "2d" → 2 days, "1w" → 7 days, in ms. Unset means "just now". */
function ageOf(ts: string | undefined): number {
  const m = /^(\d+)([dw])$/.exec(ts ?? "");
  if (!m) return 0;
  return Number(m[1]) * (m[2] === "w" ? 7 : 1) * 86_400_000;
}

export const EMPTY_DATASET: Dataset = {
  projects: [],
  deals: [],
  transactions: [],
  tasks: [],
  brain: [],
  links: [],
};
