import { describe, it, expect } from "vitest";
import { toColumn, toRow, fromRow, TABLE } from "@/lib/db/supabase-adapter";
import { seedDataset, EMPTY_DATASET, shouldSeed, DEMO_USER_KEY } from "@/lib/db/seed";
import { computeSnapshot } from "@/lib/data/workspace";

describe("supabase column mapping", () => {
  it("converts camelCase keys to snake_case columns", () => {
    expect(toColumn("userKey")).toBe("user_key");
    expect(toColumn("createdAt")).toBe("created_at");
    expect(toColumn("labelKey")).toBe("label_key");
    expect(toColumn("name")).toBe("name");
  });

  it("round-trips a row without losing fields", () => {
    const original = { userKey: "a@b.c", labelKey: "d1", done: true, seedKey: null };
    const restored = fromRow<typeof original>(toRow(original) as Record<string, unknown>);
    expect(restored).toEqual(original);
  });

  it("maps every collection to a distinct table", () => {
    const tables = Object.values(TABLE);
    expect(new Set(tables).size).toBe(tables.length);
    expect(tables.every((t) => t.startsWith("lifeos_"))).toBe(true);
  });
});

describe("demo content is never shown to real accounts", () => {
  it("only seeds the signed-out demo identity", () => {
    expect(shouldSeed(DEMO_USER_KEY)).toBe(true);
  });

  it("refuses to seed real accounts", () => {
    // uuid (Supabase auth.uid) and email identities are both real users.
    expect(shouldSeed("3a9e1133-4876-808d-997e-f9bbc809e201")).toBe(false);
    expect(shouldSeed("quincy.skyll@gmail.com")).toBe(false);
    expect(shouldSeed("")).toBe(false);
  });

  it("keeps the demo dataset free of a real user's key", () => {
    const demo = seedDataset(DEMO_USER_KEY);
    expect(demo.deals.every((d) => d.userKey === DEMO_USER_KEY)).toBe(true);
  });
});

describe("seeding", () => {
  const userKey = "seed@test.dev";
  const data = seedDataset(userKey);

  it("populates every collection", () => {
    for (const key of Object.keys(EMPTY_DATASET) as (keyof typeof EMPTY_DATASET)[]) {
      expect(data[key].length, `${key} should be seeded`).toBeGreaterThan(0);
    }
  });

  it("scopes every row to the owner", () => {
    const all = [...data.projects, ...data.deals, ...data.transactions, ...data.tasks, ...data.brain];
    expect(all.every((r) => r.userKey === userKey)).toBe(true);
    expect(all.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
  });

  it("keeps i18n keys on seeded rows so text follows the locale", () => {
    expect(data.tasks.every((t) => t.labelKey !== null && t.label === null)).toBe(true);
    expect(data.brain.every((b) => b.seedKey !== null && b.title === null)).toBe(true);
  });

  it("produces a snapshot equivalent to the demo data", () => {
    const snap = computeSnapshot(data);
    expect(snap.projects.total).toBe(data.projects.length);
    expect(snap.tasks.total).toBe(data.tasks.length);
    expect(snap.finance.net).toBe(snap.finance.income - snap.finance.expense);
  });

  it("gives different users independent datasets", () => {
    const other = seedDataset("other@test.dev");
    expect(other.projects[0].userKey).toBe("other@test.dev");
    expect(other.projects[0].userKey).not.toBe(data.projects[0].userKey);
  });
});

describe("computeSnapshot with persisted rows", () => {
  it("reflects mutations rather than the original seed", () => {
    const data = seedDataset("mutate@test.dev");
    const before = computeSnapshot(data);

    data.projects.push({
      id: "new",
      userKey: "mutate@test.dev",
      createdAt: new Date().toISOString(),
      name: "Brand new",
      status: "Blocked",
      owner: "Q",
      due: "Sep 01",
      progress: 0,
      priority: "High",
    });

    const after = computeSnapshot(data);
    expect(after.projects.total).toBe(before.projects.total + 1);
    expect(after.projects.blocked).toBe(before.projects.blocked + 1);
    expect(after.projects.blockedNames).toContain("Brand new");
  });

  it("handles an empty workspace without dividing by zero", () => {
    const snap = computeSnapshot(EMPTY_DATASET);
    expect(snap.projects.avgProgress).toBe(0);
    expect(snap.finance.net).toBe(0);
    expect(snap.tasks.total).toBe(0);
  });
});
