import { randomUUID } from "node:crypto";
import { mutateTeamsFile, readTeamsFile, type Shape } from "@/lib/team/local";
import { canManageTeam } from "@/lib/team/rules";
import { entryGone, linkByAddress, syncEntry } from "./directory";
import {
  EnterpriseError,
  type DirectoryEntry,
  type DirectoryGroup,
  type EnterpriseStore,
  type EntryInput,
  type GroupInput,
} from "./types";

/**
 * Enterprise features in the local teams file, for running LifeOS without
 * a database: the rules migration 014 enforces in Postgres, in code.
 * Single sign-on itself needs Supabase Auth (SAML); here, a provisioned
 * entry is linked to the member whose address it carries.
 */

const now = () => new Date().toISOString();
const MAX_DOMAINS = 20;
const MAX_TOKENS = 5;

function role(data: Shape, teamId: string, userKey: string) {
  return data.members.find((m) => m.teamId === teamId && m.userKey === userKey)?.role ?? null;
}

function ownerOfCompany(data: Shape, teamId: string, userKey: string) {
  const r = role(data, teamId, userKey);
  if (!r) throw new EnterpriseError("not_found");
  if (r !== "owner") throw new EnterpriseError("forbidden");
  if (data.teams.find((t) => t.id === teamId)?.kind !== "company") throw new EnterpriseError("not_company");
}

const lower = (v: string | null) => (v ?? "").toLowerCase();

function uniqueUser(data: Shape, teamId: string, input: EntryInput, except?: string) {
  const others = data.directory.filter((e) => e.teamId === teamId && e.id !== except);
  if (others.some((e) => lower(e.userName) === lower(input.userName))) throw new EnterpriseError("conflict", "userName");
  if (input.externalId && others.some((e) => e.externalId === input.externalId)) throw new EnterpriseError("conflict", "externalId");
}

function uniqueGroup(data: Shape, teamId: string, input: GroupInput, except?: string) {
  const others = data.groups.filter((g) => g.teamId === teamId && g.id !== except);
  if (others.some((g) => lower(g.displayName) === lower(input.displayName))) throw new EnterpriseError("conflict", "displayName");
  if (input.externalId && others.some((g) => g.externalId === input.externalId)) throw new EnterpriseError("conflict", "externalId");
}

/** An entry changed: linked if its address is a member's, then kept in step. */
function settle(data: Shape, e: DirectoryEntry) {
  linkByAddress(data, e);
  syncEntry(data, e.id, now(), false);
}

function setMembers(data: Shape, g: DirectoryGroup, ids: string[]) {
  const valid = new Set(data.directory.filter((e) => e.teamId === g.teamId).map((e) => e.id));
  const want = new Set(ids.filter((id) => valid.has(id)));
  const had = new Set(data.groupMembers.filter((gm) => gm.groupId === g.id).map((gm) => gm.entryId));
  data.groupMembers = data.groupMembers.filter((gm) => gm.groupId !== g.id || want.has(gm.entryId));
  for (const id of want) if (!had.has(id)) data.groupMembers.push({ groupId: g.id, entryId: id, teamId: g.teamId });
  for (const id of new Set([...had, ...want])) syncEntry(data, id, now(), false);
}

export const localEnterpriseStore: EnterpriseStore = {
  async supportsEnterprise() {
    return true;
  },

  overview(userKey, teamId) {
    return readTeamsFile((data) => {
      const r = role(data, teamId, userKey);
      const team = data.teams.find((t) => t.id === teamId);
      if (!r || !canManageTeam(r) || team?.kind !== "company") return null;
      const directory = data.directory.filter((e) => e.teamId === teamId);
      const members = data.members.filter((m) => m.teamId === teamId);
      return {
        role: r,
        domains: data.domains.filter((d) => d.teamId === teamId).sort((a, b) => a.domain.localeCompare(b.domain)),
        sso: data.sso.find((s) => s.teamId === teamId) ?? null,
        tokens:
          r === "owner"
            ? data.scimTokens
                .filter((k) => k.teamId === teamId)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map(({ tokenHash: _h, ...rest }) => rest)
            : [],
        directory: { total: directory.length, active: directory.filter((e) => e.active).length, linked: directory.filter((e) => e.userKey).length },
        groups: data.groups
          .filter((g) => g.teamId === teamId)
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((g) => ({ ...g, members: data.groupMembers.filter((gm) => gm.groupId === g.id).length })),
        members: { total: members.length, viaSso: members.filter((m) => m.viaSso).length },
      };
    });
  },

  claimDomain(userKey, teamId, domain, token) {
    return mutateTeamsFile((data) => {
      ownerOfCompany(data, teamId, userKey);
      const mine = data.domains.find((d) => d.teamId === teamId && d.domain === domain);
      if (mine) return mine;
      if (data.domains.some((d) => d.domain === domain && d.verifiedAt)) throw new EnterpriseError("domain_taken");
      if (data.domains.filter((d) => d.teamId === teamId).length >= MAX_DOMAINS) throw new EnterpriseError("too_many");
      const row = { id: randomUUID(), teamId, domain, token, verifiedAt: null, createdBy: userKey, createdAt: now() };
      data.domains.push(row);
      return row;
    });
  },

  removeDomain(userKey, teamId, domainId) {
    return mutateTeamsFile((data) => {
      ownerOfCompany(data, teamId, userKey);
      const before = data.domains.length;
      data.domains = data.domains.filter((d) => !(d.id === domainId && d.teamId === teamId));
      if (data.domains.length === before) throw new EnterpriseError("not_found");
    });
  },

  markDomainVerified(teamId, domainId) {
    return mutateTeamsFile((data) => {
      const d = data.domains.find((x) => x.id === domainId && x.teamId === teamId);
      if (!d) throw new EnterpriseError("not_found");
      if (d.verifiedAt) return;
      if (data.domains.some((x) => x !== d && x.domain === d.domain && x.verifiedAt)) throw new EnterpriseError("domain_taken");
      d.verifiedAt = now();
    });
  },

  linkSso(teamId, conn) {
    return mutateTeamsFile((data) => {
      if (data.sso.some((s) => s.providerId === conn.providerId && s.teamId !== teamId)) throw new EnterpriseError("conflict");
      const had = data.sso.find((s) => s.teamId === teamId);
      data.sso = data.sso.filter((s) => s.teamId !== teamId);
      // A re-link (new metadata) keeps the owner's choices.
      data.sso.push({
        teamId,
        providerId: conn.providerId,
        metadataUrl: conn.metadataUrl,
        jit: had?.jit ?? true,
        enforce: had?.enforce ?? false,
        createdBy: conn.createdBy,
        createdAt: had?.createdAt ?? now(),
        updatedAt: now(),
      });
    });
  },

  unlinkSso(teamId) {
    return mutateTeamsFile((data) => {
      data.sso = data.sso.filter((s) => s.teamId !== teamId);
    });
  },

  setSsoOptions(userKey, teamId, patch) {
    return mutateTeamsFile((data) => {
      ownerOfCompany(data, teamId, userKey);
      const s = data.sso.find((x) => x.teamId === teamId);
      if (!s) throw new EnterpriseError("not_found");
      if (patch.jit !== undefined) s.jit = patch.jit;
      if (patch.enforce !== undefined) s.enforce = patch.enforce;
      s.updatedAt = now();
    });
  },

  createScimToken(userKey, teamId, label, tokenHash) {
    return mutateTeamsFile((data) => {
      ownerOfCompany(data, teamId, userKey);
      if (data.scimTokens.filter((k) => k.teamId === teamId && !k.revokedAt).length >= MAX_TOKENS) throw new EnterpriseError("too_many");
      if (data.scimTokens.some((k) => k.tokenHash === tokenHash)) throw new EnterpriseError("conflict");
      data.scimTokens.push({ id: randomUUID(), teamId, tokenHash, label: label.trim(), createdBy: userKey, createdAt: now(), lastUsedAt: null, revokedAt: null });
    });
  },

  revokeScimToken(userKey, teamId, tokenId) {
    return mutateTeamsFile((data) => {
      ownerOfCompany(data, teamId, userKey);
      const k = data.scimTokens.find((x) => x.id === tokenId && x.teamId === teamId);
      if (!k) throw new EnterpriseError("not_found");
      k.revokedAt = k.revokedAt ?? now();
    });
  },

  setGroupRole(userKey, teamId, groupId, r) {
    return mutateTeamsFile((data) => {
      ownerOfCompany(data, teamId, userKey);
      const g = data.groups.find((x) => x.id === groupId && x.teamId === teamId);
      if (!g) throw new EnterpriseError("not_found");
      if (g.role === r) return;
      g.role = r;
      g.updatedAt = now();
      for (const gm of data.groupMembers.filter((x) => x.groupId === g.id)) syncEntry(data, gm.entryId, now(), false);
    });
  },

  /* ── Provisioning (trusted: after a token is resolved) ─────────────── */

  resolveToken(tokenHash) {
    return readTeamsFile((data) => {
      const k = data.scimTokens.find((x) => x.tokenHash === tokenHash && !x.revokedAt);
      if (!k || !data.teams.some((t) => t.id === k.teamId)) return null;
      return { teamId: k.teamId, tokenId: k.id, lastUsedAt: k.lastUsedAt };
    });
  },

  touchToken(tokenId) {
    return mutateTeamsFile((data) => {
      const k = data.scimTokens.find((x) => x.id === tokenId);
      if (k) k.lastUsedAt = now();
    });
  },

  seats(teamId) {
    return readTeamsFile((data) => data.teams.find((t) => t.id === teamId)?.seats ?? 0);
  },

  users(teamId, where) {
    return readTeamsFile((data) =>
      data.directory
        .filter((e) => e.teamId === teamId)
        .filter((e) => where?.userName === undefined || lower(e.userName) === lower(where.userName))
        .filter((e) => where?.externalId === undefined || e.externalId === where.externalId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    );
  },

  user(teamId, id) {
    return readTeamsFile((data) => data.directory.find((e) => e.teamId === teamId && e.id === id) ?? null);
  },

  createUser(teamId, input) {
    return mutateTeamsFile((data) => {
      uniqueUser(data, teamId, input);
      const e: DirectoryEntry = { id: randomUUID(), teamId, ...input, userKey: null, createdAt: now(), updatedAt: now() };
      data.directory.push(e);
      settle(data, e);
      return e;
    });
  },

  updateUser(teamId, id, input) {
    return mutateTeamsFile((data) => {
      const e = data.directory.find((x) => x.teamId === teamId && x.id === id);
      if (!e) return null;
      uniqueUser(data, teamId, input, id);
      Object.assign(e, input, { updatedAt: now() });
      settle(data, e);
      return e;
    });
  },

  deleteUser(teamId, id) {
    return mutateTeamsFile((data) => {
      const e = data.directory.find((x) => x.teamId === teamId && x.id === id);
      if (!e) return false;
      entryGone(data, e);
      data.directory = data.directory.filter((x) => x !== e);
      const groups = data.groupMembers.filter((gm) => gm.entryId === id).map((gm) => gm.groupId);
      data.groupMembers = data.groupMembers.filter((gm) => gm.entryId !== id);
      for (const g of data.groups.filter((x) => groups.includes(x.id))) g.updatedAt = now();
      return true;
    });
  },

  groups(teamId, where) {
    return readTeamsFile((data) =>
      data.groups
        .filter((g) => g.teamId === teamId)
        .filter((g) => where?.displayName === undefined || lower(g.displayName) === lower(where.displayName))
        .filter((g) => where?.externalId === undefined || g.externalId === where.externalId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    );
  },

  group(teamId, id) {
    return readTeamsFile((data) => data.groups.find((g) => g.teamId === teamId && g.id === id) ?? null);
  },

  groupMembers(teamId, groupIds) {
    return readTeamsFile((data) => data.groupMembers.filter((gm) => gm.teamId === teamId && (!groupIds || groupIds.includes(gm.groupId))));
  },

  createGroup(teamId, input) {
    return mutateTeamsFile((data) => {
      uniqueGroup(data, teamId, input);
      const g: DirectoryGroup = { id: randomUUID(), teamId, displayName: input.displayName, externalId: input.externalId, role: "member", createdAt: now(), updatedAt: now() };
      data.groups.push(g);
      setMembers(data, g, input.members);
      return g;
    });
  },

  updateGroup(teamId, id, input) {
    return mutateTeamsFile((data) => {
      const g = data.groups.find((x) => x.teamId === teamId && x.id === id);
      if (!g) return null;
      uniqueGroup(data, teamId, input, id);
      Object.assign(g, { displayName: input.displayName, externalId: input.externalId, updatedAt: now() });
      setMembers(data, g, input.members);
      return g;
    });
  },

  deleteGroup(teamId, id) {
    return mutateTeamsFile((data) => {
      const g = data.groups.find((x) => x.teamId === teamId && x.id === id);
      if (!g) return false;
      const former = data.groupMembers.filter((gm) => gm.groupId === id).map((gm) => gm.entryId);
      data.groups = data.groups.filter((x) => x !== g);
      data.groupMembers = data.groupMembers.filter((gm) => gm.groupId !== id);
      for (const entryId of former) syncEntry(data, entryId, now(), false);
      return true;
    });
  },
};
