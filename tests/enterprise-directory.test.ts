import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { TeamStore } from "@/lib/team/types";
import type { EnterpriseStore } from "@/lib/enterprise/types";
import type { ScimRequest, ScimResponse } from "@/lib/enterprise/scim-handler";

/**
 * The SCIM endpoint end to end on the file store, in a throwaway
 * directory: a provider provisions, deactivates, groups and deletes, and
 * the team follows — the scenario migration 014's checks run in Postgres.
 */
let teams: TeamStore;
let ent: EnterpriseStore;
let handle: (req: ScimRequest, store: EnterpriseStore) => Promise<ScimResponse>;
let dir: string;

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const TOKEN = "lifeos_scim_" + randomBytes(32).toString("base64url");
const BASE = "https://app.example/api/scim/v2";
const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function scim(method: string, path: string, body?: unknown, token: string | null = TOKEN) {
  const [p, q = ""] = path.split("?");
  return handle(
    { method, segments: p.split("/").filter(Boolean), params: new URLSearchParams(q), body, authorization: token ? `Bearer ${token}` : null, base: BASE },
    ent
  );
}
const role = async (team: string, who: string) => (await teams.team("alice@acme.com", team))?.members.find((m) => m.userKey === who)?.role ?? null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lifeos-enterprise-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  teams = (await import("@/lib/team/local")).localTeamStore;
  ent = (await import("@/lib/enterprise/local")).localEnterpriseStore;
  handle = (await import("@/lib/enterprise/scim-handler")).handleScim;
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("a company's directory, provisioned over SCIM", () => {
  let team = "";
  let circle = "";
  let bob = "";
  let admins = "";

  it("starts with an owner, a member and a provisioning token", async () => {
    team = (await teams.createTeam("alice@acme.com", { name: "Acme", kind: "company", displayName: "Alice", seats: 4 })).id;
    circle = (await teams.createTeam("alice@acme.com", { name: "Peers", kind: "circle", displayName: "Alice", seats: 5 })).id;
    await teams.createInvite("alice@acme.com", team, { role: "member", maxUses: 5, expiresAt: future(), tokenHash: sha("inv") });
    await teams.acceptInvite("bob@acme.com", sha("inv"), "Bob");
    await expect(ent.createScimToken("bob@acme.com", team, "x", sha("nope"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(ent.createScimToken("alice@acme.com", circle, "x", sha("nope"))).rejects.toMatchObject({ code: "not_company" });
    await ent.createScimToken("alice@acme.com", team, "Entra ID", sha(TOKEN));
  });

  it("refuses anyone without the token", async () => {
    expect((await scim("GET", "Users", undefined, null)).status).toBe(401);
    expect((await scim("GET", "Users", undefined, "lifeos_scim_" + "A".repeat(43))).status).toBe(401);
    const bad = await scim("GET", "Users", undefined, "not-even-shaped");
    expect(bad.status).toBe(401);
    expect(bad.headers?.["WWW-Authenticate"]).toContain("Bearer");
    expect(bad.body).toMatchObject({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "401" });
  });

  it("describes itself", async () => {
    const spc = await scim("GET", "ServiceProviderConfig");
    expect(spc.status).toBe(200);
    expect(spc.body).toMatchObject({ patch: { supported: true }, bulk: { supported: false }, filter: { supported: true } });
    expect((await scim("GET", "ResourceTypes")).body).toMatchObject({ totalResults: 2 });
    expect((await scim("GET", "Schemas/urn:ietf:params:scim:schemas:core:2.0:User")).status).toBe(200);
    expect((await scim("GET", "Bulk")).status).toBe(501);
    expect((await scim("GET", "Nothing")).status).toBe(404);
    expect((await scim("DELETE", "ServiceProviderConfig")).status).toBe(405);
  });

  it("creates people, once each", async () => {
    const res = await scim("POST", "Users", { userName: "hana@acme.com", name: { givenName: "Hana", familyName: "Ito" }, emails: [{ value: "hana@acme.com", primary: true }] });
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    expect(res.headers?.Location).toBe(`${BASE}/Users/${id}`);
    const dup = await scim("POST", "Users", { userName: "HANA@acme.com" });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ scimType: "uniqueness" });
    const found = await scim("GET", 'Users?filter=userName eq "Hana@Acme.com"');
    expect(found.body).toMatchObject({ totalResults: 1, Resources: [{ id, userName: "hana@acme.com", active: true }] });
    expect((await scim("GET", 'Users?filter=userName eq "nobody@acme.com"')).body).toMatchObject({ totalResults: 0, Resources: [] });
    expect((await scim("GET", "Users/not-a-uuid")).status).toBe(404);
    expect((await scim("GET", 'Users?filter=userName zz "x"')).status).toBe(400);
  });

  it("links a provisioned person to the member with their address (the file store's sign-in)", async () => {
    const res = await scim("POST", "Users", { userName: "bob@acme.com", externalId: "entra-bob", displayName: "Bob B." });
    bob = (res.body as { id: string }).id;
    const o = await ent.overview("alice@acme.com", team);
    expect(o?.directory).toEqual({ total: 2, active: 2, linked: 1 });
  });

  it("takes someone out of the team the moment the provider deactivates them, and back", async () => {
    const off = await scim("PATCH", `Users/${bob}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "Replace", path: "active", value: "False" }] });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ active: false });
    expect(await role(team, "bob@acme.com")).toBeNull();
    await scim("PATCH", `Users/${bob}`, { Operations: [{ op: "replace", value: { active: true } }] });
    expect(await role(team, "bob@acme.com")).toBe("member");
  });

  it("makes admins through a group the owner maps — and only such admins does it undo", async () => {
    const g = await scim("POST", "Groups", { displayName: "LifeOS Admins", members: [{ value: bob }] });
    expect(g.status).toBe(201);
    admins = (g.body as { id: string }).id;
    expect(g.body).toMatchObject({ displayName: "LifeOS Admins", members: [{ value: bob, display: "Bob B." }] });
    expect(await role(team, "bob@acme.com")).toBe("member");
    await expect(ent.setGroupRole("bob@acme.com", team, admins, "admin")).rejects.toMatchObject({ code: "forbidden" });
    await ent.setGroupRole("alice@acme.com", team, admins, "admin");
    expect(await role(team, "bob@acme.com")).toBe("admin");
    const out = await scim("PATCH", `Groups/${admins}`, { Operations: [{ op: "Remove", path: "members", value: [{ value: bob }] }] });
    expect(out.status).toBe(204);
    expect(await role(team, "bob@acme.com")).toBe("member");
    await scim("PATCH", `Groups/${admins}`, { Operations: [{ op: "Add", path: "members", value: [{ value: bob }] }] });
    expect(await role(team, "bob@acme.com")).toBe("admin");
    // A role chosen by hand is not the directory's to take back.
    await teams.setRole("alice@acme.com", team, "bob@acme.com", "member");
    await teams.setRole("alice@acme.com", team, "bob@acme.com", "admin");
    await scim("PATCH", `Groups/${admins}`, { Operations: [{ op: "remove", path: `members[value eq "${bob}"]` }] });
    expect(await role(team, "bob@acme.com")).toBe("admin");
    await teams.setRole("alice@acme.com", team, "bob@acme.com", "member");
  });

  it("lists groups, with or without their members", async () => {
    const lean = await scim("GET", 'Groups?filter=displayName eq "lifeos admins"&excludedAttributes=members');
    expect(lean.body).toMatchObject({ totalResults: 1 });
    expect((lean.body as { Resources: Record<string, unknown>[] }).Resources[0].members).toBeUndefined();
    expect((await scim("POST", "Groups", { displayName: "lifeos ADMINS" })).status).toBe(409);
    const user = await scim("GET", `Users/${bob}`);
    expect(user.body).toMatchObject({ userName: "bob@acme.com" });
  });

  it("never touches the owner", async () => {
    const res = await scim("POST", "Users", { userName: "alice@acme.com" });
    const id = (res.body as { id: string }).id;
    await scim("PATCH", `Users/${id}`, { Operations: [{ op: "replace", path: "active", value: false }] });
    expect(await role(team, "alice@acme.com")).toBe("owner");
    expect((await scim("DELETE", `Users/${id}`)).status).toBe(204);
    expect(await role(team, "alice@acme.com")).toBe("owner");
  });

  it("waits for a seat, rather than overfilling the team", async () => {
    await scim("PATCH", `Users/${bob}`, { Operations: [{ op: "replace", path: "active", value: false }] });
    await teams.createInvite("alice@acme.com", team, { role: "member", maxUses: 5, expiresAt: future(), tokenHash: sha("inv2") });
    await teams.acceptInvite("carol@acme.com", sha("inv2"), "Carol");
    await teams.updateTeam("alice@acme.com", team, { seats: 2 });
    await scim("PATCH", `Users/${bob}`, { Operations: [{ op: "replace", path: "active", value: true }] });
    expect(await role(team, "bob@acme.com")).toBeNull();
    await teams.updateTeam("alice@acme.com", team, { seats: 10 });
    await scim("PATCH", `Users/${bob}`, { Operations: [{ op: "replace", path: "title", value: "Engineer" }] });
    expect(await role(team, "bob@acme.com")).toBe("member");
  });

  it("replaces a person whole with PUT", async () => {
    const put = await scim("PUT", `Users/${bob}`, { userName: "bob@acme.com", externalId: "entra-bob", displayName: "Robert" });
    expect(put.body).toMatchObject({ displayName: "Robert", active: true });
    expect((put.body as Record<string, unknown>).title).toBeUndefined();
  });

  it("shows its owner what it did — and no one else", async () => {
    const o = await ent.overview("alice@acme.com", team);
    // Hana and Bob (Alice's own entry was deleted above); Bob linked.
    expect(o).toMatchObject({ role: "owner", directory: { total: 2, active: 2, linked: 1 }, groups: [{ displayName: "LifeOS Admins", role: "admin", members: 0 }] });
    expect(o?.tokens).toHaveLength(1);
    expect(JSON.stringify(o)).not.toContain(sha(TOKEN));
    expect(await ent.overview("carol@acme.com", team)).toBeNull();
    expect(await ent.overview("alice@acme.com", circle)).toBeNull();
  });

  it("takes someone deleted by the provider out of the team", async () => {
    expect((await scim("DELETE", `Users/${bob}`)).status).toBe(204);
    expect(await role(team, "bob@acme.com")).toBeNull();
    expect((await scim("GET", `Users/${bob}`)).status).toBe(404);
    expect((await scim("DELETE", `Groups/${admins}`)).status).toBe(204);
  });

  it("stops at a revoked token", async () => {
    const [t] = (await ent.overview("alice@acme.com", team))!.tokens;
    await ent.revokeScimToken("alice@acme.com", team, t.id);
    expect((await scim("GET", "Users")).status).toBe(401);
  });
});

describe("domains in the file store", () => {
  it("follow 014's rules", async () => {
    const acme = (await teams.createTeam("owner@acme.io", { name: "Acme IO", kind: "company", displayName: "O", seats: 3 })).id;
    const other = (await teams.createTeam("owner@other.io", { name: "Other", kind: "company", displayName: "O", seats: 3 })).id;
    const d = await ent.claimDomain("owner@acme.io", acme, "acme.io", "0".repeat(32));
    expect((await ent.claimDomain("owner@acme.io", acme, "acme.io", "1".repeat(32))).id).toBe(d.id);
    const theirs = await ent.claimDomain("owner@other.io", other, "acme.io", "2".repeat(32));
    await ent.markDomainVerified(acme, d.id);
    await expect(ent.markDomainVerified(other, theirs.id)).rejects.toMatchObject({ code: "domain_taken" });
    await expect(ent.claimDomain("owner@other.io", other, "acme.io", "3".repeat(32))).resolves.toMatchObject({ id: theirs.id });
    await ent.removeDomain("owner@other.io", other, theirs.id);
    await expect(ent.claimDomain("owner@other.io", other, "acme.io", "3".repeat(32))).rejects.toMatchObject({ code: "domain_taken" });
    await teams.deleteTeam("owner@acme.io", acme);
    expect(await ent.overview("owner@acme.io", acme)).toBeNull();
    await expect(ent.claimDomain("owner@other.io", other, "acme.io", "4".repeat(32))).resolves.toMatchObject({ domain: "acme.io" });
  });
});
