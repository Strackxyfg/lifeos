import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { TeamStore } from "@/lib/team/types";

/**
 * The file team store end to end, in a throwaway directory — the same
 * scenario the migration's checks run against Postgres: create, invite,
 * seats, roles, sharing, pulse, leaving, forgetting.
 */
let store: TeamStore;
let dir: string;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lifeos-teams-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  store = (await import("@/lib/team/local")).localTeamStore;
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("a team in the file store", () => {
  let team = "";

  it("is created with its creator as owner, and invisible to others", async () => {
    const t = await store.createTeam("alice", { name: " Acme ", kind: "company", displayName: "Alice", seats: 3 });
    team = t.id;
    expect(t.name).toBe("Acme");
    expect((await store.team("alice", team))?.members.map((m) => m.role)).toEqual(["owner"]);
    expect(await store.team("bob", team)).toBeNull();
    expect(await store.notes("bob", team)).toEqual([]);
  });

  it("lets people in with a link, up to the seats", async () => {
    await store.createInvite("alice", team, { role: "member", maxUses: 10, expiresAt: future(), tokenHash: hash("link") });
    expect((await store.previewInvite("bob", hash("link"))).state).toBe("ok");
    expect(await store.acceptInvite("bob", hash("link"), "Bob")).toMatchObject({ state: "ok", teamId: team });
    expect((await store.acceptInvite("bob", hash("link"), "Bob")).state).toBe("member");
    expect((await store.acceptInvite("carol", hash("link"), "Carol")).state).toBe("ok");
    expect((await store.acceptInvite("dan", hash("link"), "Dan")).state).toBe("full");
    await expect(store.updateTeam("alice", team, { seats: 2 })).rejects.toMatchObject({ code: "seats" });
    await store.updateTeam("alice", team, { seats: 4 });
    expect((await store.acceptInvite("dan", hash("link"), "Dan")).state).toBe("ok");
  });

  it("keeps roles to their rules", async () => {
    await expect(store.createInvite("bob", team, { role: "member", maxUses: 1, expiresAt: future(), tokenHash: hash("x") })).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.setRole("bob", team, "alice", "member")).rejects.toMatchObject({ code: "forbidden" });
    await store.setRole("alice", team, "bob", "admin");
    await expect(store.createInvite("bob", team, { role: "admin", maxUses: 1, expiresAt: future(), tokenHash: hash("y") })).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.removeMember("bob", team, "alice")).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.removeMember("alice", team, "alice")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps the welcome pack to owners and admins", async () => {
    const n = await store.addNote("carol", team, { sourceId: "w1", category: "knowledge", title: "How we ship", detail: null, concepts: [] });
    // Permission first: a member learns nothing, not even whether the note exists.
    await expect(store.pinNote("carol", team, n.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.pinNote("carol", team, "nope", true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.pinNote("stranger", team, n.id, true)).rejects.toMatchObject({ code: "not_found" });
    await store.pinNote("alice", team, n.id, true);
    const pinned = (await store.notes("dan", team)).find((x) => x.id === n.id);
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.pinnedAt).toBeTruthy();
    await expect(store.pinNote("alice", team, "nope", true)).rejects.toMatchObject({ code: "not_found" });
    await store.pinNote("bob", team, n.id, false); // an admin tidies it too
    const unpinned = (await store.notes("dan", team)).find((x) => x.id === n.id);
    expect(unpinned).toMatchObject({ pinned: false, pinnedAt: null });
    await store.removeNote("carol", team, n.id);
  });

  it("shares notes, check-ins and kudos, each under its author's control", async () => {
    const n = await store.addNote("carol", team, { sourceId: "p1", category: "knowledge", title: "Checklist", detail: null, concepts: [] });
    await expect(store.addNote("carol", team, { sourceId: "p1", category: "knowledge", title: "Again", detail: null, concepts: [] })).rejects.toMatchObject({ code: "invalid" });
    await expect(store.removeNote("dan", team, n.id)).rejects.toMatchObject({ code: "forbidden" });
    await store.removeNote("bob", team, n.id); // an admin moderates
    const c = await store.saveCheckin("carol", team, "2026-W40", { done: "v2", focus: "pricing", blocker: "legal", helpWanted: true });
    const again = await store.saveCheckin("carol", team, "2026-W40", { done: "v2.1", focus: "pricing", blocker: "", helpWanted: false });
    expect(again.id).toBe(c.id);
    await expect(store.setHelp("carol", team, c.id, true)).rejects.toMatchObject({ code: "self" });
    await store.setHelp("dan", team, c.id, true);
    expect((await store.checkins("alice", team, "2026-W40")).help).toHaveLength(1);
    await expect(store.giveKudos("dan", team, "dan", "me")).rejects.toMatchObject({ code: "self" });
    await expect(store.giveKudos("dan", team, "stranger", "hi")).rejects.toMatchObject({ code: "not_found" });
    await store.giveKudos("dan", team, "carol", "Thanks for v2");
    expect(await store.kudos("alice", team, 10)).toHaveLength(1);
  });

  it("shows the pulse only from five answers", async () => {
    for (const [who, e] of [["alice", 4], ["bob", 3], ["carol", 2], ["dan", 5]] as const) await store.savePulse(who, team, "2026-W40", e, 3);
    expect(await store.pulse("alice", team, "2026-W40")).toEqual({ responses: 4, energy: null, load: null });
    expect((await store.myPulse("bob", team, "2026-W40"))?.energy).toBe(3);
    await expect(store.pulse("stranger", team, "2026-W40")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("forgets a person entirely, handing the team on", async () => {
    await store.setRole("alice", team, "carol", "owner");
    await store.forget("carol");
    const t = await store.team("alice", team);
    expect(t?.members.find((m) => m.role === "owner")?.userKey).toBe("alice");
    expect((await store.checkins("alice", team, "2026-W40")).checkins).toHaveLength(0);
    expect(await store.kudos("alice", team, 10)).toHaveLength(0);
  });
});
