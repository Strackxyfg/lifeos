import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

/**
 * The export that says "complete": besides the brain, everything the person
 * keeps — and nothing of anyone else's, not even a teammate's account key.
 */
let dir: string;
const saved: Record<string, string | undefined> = {};
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lifeos-export-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  // The file stores, whatever the machine running the tests has configured.
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});

describe("the complete export", () => {
  it("carries the workspace and what was written in teams, without anyone's account", async () => {
    const { getStore } = await import("@/lib/db/store");
    const { localTeamStore: teams } = await import("@/lib/team/local");
    const { loadWorkspaceExport } = await import("@/lib/export/workspace");
    const store = getStore();
    expect(store.backend).toBe("local");

    await store.insert("ada@x.test", "deals", { name: "Acme pilot", company: "Acme", stage: "Qualified", value: 24000, owner: "Ada", next: "Scope call" });
    await store.insert("ada@x.test", "transactions", { item: "Stripe payout", type: "Income", amount: 1200, category: "Revenue", date: "Sep 26", occurredOn: "2026-09-26" });
    await store.insert("eve@x.test", "deals", { name: "Eve's secret deal", company: "Evil", stage: "Lead", value: 1, owner: "Eve", next: "—" });

    const t = await teams.createTeam("ada@x.test", { name: "Acme", kind: "company", displayName: "Ada", seats: 5 });
    await teams.createInvite("ada@x.test", t.id, { role: "member", maxUses: 2, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), tokenHash: sha("i") });
    await teams.acceptInvite("bob@x.test", sha("i"), "Bob");
    await teams.addNote("ada@x.test", t.id, { sourceId: null, category: "knowledge", title: "How we ship", detail: "Small PRs", concepts: [] });
    await teams.addNote("bob@x.test", t.id, { sourceId: null, category: "knowledge", title: "Bob's note", detail: null, concepts: [] });
    await teams.giveKudos("bob@x.test", t.id, "ada@x.test", "Thanks for the review");
    await teams.savePulse("ada@x.test", t.id, "2026-W40", 4, 2);

    const out = await loadWorkspaceExport("ada@x.test");
    expect(out.collections.deals.map((d) => d.name)).toContain("Acme pilot");
    expect(out.collections.transactions.find((x) => x.item === "Stripe payout")).toMatchObject({ amount: 1200, occurredOn: "2026-09-26" });
    for (const c of ["projects", "tasks", "reminders", "balances", "reviews"] as const) expect(Array.isArray(out.collections[c])).toBe(true);
    expect(out.teams).toHaveLength(1);
    expect(out.teams[0]).toMatchObject({
      name: "Acme",
      role: "owner",
      displayName: "Ada",
      notes: [{ title: "How we ship", detail: "Small PRs" }],
      pulse: [{ week: "2026-W40", energy: 4, load: 2 }],
      kudos: [{ direction: "received", with: "Bob", message: "Thanks for the review" }],
    });

    const text = JSON.stringify(out);
    expect(text).not.toContain("Eve's secret deal");
    expect(text).not.toContain("Bob's note");
    expect(text).not.toContain("bob@x.test");
    expect(text).not.toContain("userKey");
  });
});
