import { createRlsClient } from "@/lib/supabase/rls";
import { createAdminClient } from "@/lib/supabase/admin";
import { fromRow } from "@/lib/db/supabase-adapter";
import { isMissingTable } from "@/lib/db/errors";
import type { Role } from "@/lib/team/rules";
import {
  EnterpriseError,
  type DirectoryEntry,
  type DirectoryGroup,
  type EnterpriseStore,
  type EntryInput,
  type GroupMember,
  type ScimToken,
  type SsoConnection,
  type TeamDomain,
} from "./types";

/**
 * Enterprise features in Supabase. The owner's side goes through their
 * own session: migration 014's policies, column privileges and functions
 * decide. The rest runs with the service role, and only in three places
 * that checked something first: the SCIM endpoint (a token resolved to a
 * team — every query here is scoped by that team id), marking a domain
 * verified (the DNS record read), linking a provider (Supabase Auth
 * registered it). Keeping the team in step with the directory is the
 * database's job (014's triggers), whoever writes.
 */

const T = {
  teams: "lifeos_teams",
  members: "lifeos_team_members",
  domains: "lifeos_team_domains",
  sso: "lifeos_team_sso",
  tokens: "lifeos_scim_tokens",
  directory: "lifeos_team_directory",
  groups: "lifeos_team_groups",
  groupMembers: "lifeos_team_group_members",
} as const;

type Row = Record<string, unknown>;
type PgError = { message: string; code?: string } | null;
const rows = <X>(data: Row[] | null) => (data ?? []).map((r) => fromRow<X>(r));

function check(error: PgError, what: string): void {
  if (!error) return;
  const m = error.message;
  if (error.code === "42501" || /permission denied|row-level security|forbidden/i.test(m)) throw new EnterpriseError("forbidden");
  if (/not_company/.test(m)) throw new EnterpriseError("not_company");
  if (/domain_taken/.test(m) || (error.code === "23505" && /lifeos_team_domains_verified/.test(m))) throw new EnterpriseError("domain_taken");
  if (/too_many_domains|too_many_tokens/.test(m)) throw new EnterpriseError("too_many");
  if (error.code === "P0002") throw new EnterpriseError("not_found");
  if (error.code === "23505") throw new EnterpriseError("conflict");
  if (error.code === "23514" || error.code === "22P02" || error.code === "22001") throw new EnterpriseError("invalid");
  throw new Error(`[enterprise] ${what}: ${m}`);
}

/** Every row a query returns, a thousand at a time (PostgREST's page). */
async function all<X>(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: PgError }>, what: string): Promise<X[]> {
  const out: X[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    check(error, what);
    out.push(...rows<X>(data));
    if (!data || data.length < 1000) return out;
  }
}

const chunks = <X>(xs: X[], n: number): X[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
/** An ILIKE pattern that matches exactly this text, case aside. */
const exactly = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function entryRow(teamId: string, e: EntryInput): Row {
  return {
    team_id: teamId,
    user_name: e.userName,
    external_id: e.externalId,
    email: e.email,
    given_name: e.givenName,
    family_name: e.familyName,
    display_name: e.displayName,
    title: e.title,
    active: e.active,
  };
}

let probe: { value: boolean; until: number } | null = null;

export const supabaseEnterpriseStore: EnterpriseStore = {
  async supportsEnterprise() {
    if (probe && Date.now() < probe.until) return probe.value;
    const db = await createRlsClient();
    const { error } = await db.from(T.domains).select("id").limit(1);
    const value = !error || !isMissingTable(`${error.code ?? ""} ${error.message}`);
    probe = { value, until: value ? Number.POSITIVE_INFINITY : Date.now() + 60_000 };
    return value;
  },

  async overview(_userKey, teamId) {
    const db = await createRlsClient();
    // The role as the team requires it to be signed in (014's lifeos_team_role).
    const [{ data: roleData, error: e0 }, { data: team, error: e1 }] = await Promise.all([
      db.rpc("lifeos_team_role", { p_team: teamId }),
      db.from(T.teams).select("kind").eq("id", teamId).maybeSingle(),
    ]);
    check(e0, "role");
    check(e1, "team");
    const role = (typeof roleData === "string" ? roleData : null) as Role | null;
    if (!role || role === "member" || team?.kind !== "company") return null;

    const head = { count: "exact" as const, head: true };
    const [domains, sso, tokens, groups, total, active, linked, members, viaSso] = await Promise.all([
      db.from(T.domains).select("*").eq("team_id", teamId).order("domain"),
      db.from(T.sso).select("*").eq("team_id", teamId).maybeSingle(),
      role === "owner"
        ? db.from(T.tokens).select("id, team_id, label, created_by, created_at, last_used_at, revoked_at").eq("team_id", teamId).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as Row[], error: null }),
      db.from(T.groups).select("*").eq("team_id", teamId).order("display_name"),
      db.from(T.directory).select("id", head).eq("team_id", teamId),
      db.from(T.directory).select("id", head).eq("team_id", teamId).eq("active", true),
      db.from(T.directory).select("id", head).eq("team_id", teamId).not("user_key", "is", null),
      db.from(T.members).select("user_key", head).eq("team_id", teamId),
      db.from(T.members).select("user_key", head).eq("team_id", teamId).eq("via_sso", true),
    ]);
    for (const [r, what] of [
      [domains, "domains"],
      [sso, "sso"],
      [tokens, "tokens"],
      [groups, "groups"],
      [total, "directory"],
      [active, "directory active"],
      [linked, "directory linked"],
      [members, "members"],
      [viaSso, "members via sso"],
    ] as const) {
      check(r.error, what);
    }

    const groupRows = rows<DirectoryGroup>(groups.data);
    const sizes = await Promise.all(
      groupRows.map(async (g) => {
        const { count: n, error } = await db.from(T.groupMembers).select("entry_id", { count: "exact", head: true }).eq("group_id", g.id);
        check(error, "group size");
        return n ?? 0;
      })
    );
    return {
      role,
      domains: rows<TeamDomain>(domains.data),
      sso: sso.data ? fromRow<SsoConnection>(sso.data) : null,
      tokens: rows<Omit<ScimToken, "tokenHash">>(tokens.data),
      directory: { total: total.count ?? 0, active: active.count ?? 0, linked: linked.count ?? 0 },
      groups: groupRows.map((g, i) => ({ ...g, members: sizes[i] })),
      members: { total: members.count ?? 0, viaSso: viaSso.count ?? 0 },
    };
  },

  async claimDomain(_userKey, teamId, domain, token) {
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_claim_domain", { p_team: teamId, p_domain: domain, p_token: token });
    check(error, "claim domain");
    const { data: row, error: e2 } = await db.from(T.domains).select("*").eq("id", data as string).single();
    check(e2, "read claim");
    return fromRow<TeamDomain>(row);
  },

  async removeDomain(_userKey, teamId, domainId) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.domains).delete().eq("id", domainId).eq("team_id", teamId).select("id");
    check(error, "remove domain");
    if (!data?.length) throw new EnterpriseError("forbidden");
  },

  async markDomainVerified(teamId, domainId) {
    const db = createAdminClient();
    const { error } = await db.from(T.domains).update({ verified_at: new Date().toISOString() }).eq("id", domainId).eq("team_id", teamId).is("verified_at", null);
    check(error, "verify domain");
  },

  async linkSso(teamId, conn) {
    const db = createAdminClient();
    // jit and enforce are left out: a new link takes their defaults, a
    // re-link (new metadata) keeps what the owner chose.
    const { error } = await db.from(T.sso).upsert(
      {
        team_id: teamId,
        provider_id: conn.providerId,
        metadata_url: conn.metadataUrl,
        created_by: conn.createdBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_id" }
    );
    check(error, "link sso");
  },

  async unlinkSso(teamId) {
    const db = createAdminClient();
    const { error } = await db.from(T.sso).delete().eq("team_id", teamId);
    check(error, "unlink sso");
  },

  async setSsoOptions(_userKey, teamId, patch) {
    const db = await createRlsClient();
    const update: Row = { updated_at: new Date().toISOString() };
    if (patch.jit !== undefined) update.jit = patch.jit;
    if (patch.enforce !== undefined) update.enforce = patch.enforce;
    const { data, error } = await db.from(T.sso).update(update).eq("team_id", teamId).select("team_id");
    check(error, "sso options");
    if (!data?.length) throw new EnterpriseError("forbidden");
  },

  async createScimToken(_userKey, teamId, label, tokenHash) {
    const db = await createRlsClient();
    const { error } = await db.rpc("lifeos_create_scim_token", { p_team: teamId, p_hash: tokenHash, p_label: label });
    check(error, "create token");
  },

  async revokeScimToken(_userKey, teamId, tokenId) {
    const db = await createRlsClient();
    const { data, error } = await db
      .from(T.tokens)
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId)
      .eq("team_id", teamId)
      .is("revoked_at", null)
      .select("id");
    check(error, "revoke token");
    if (data?.length) return;
    // Nothing updated: already revoked (fine), or not the owner's to revoke.
    const { data: seen, error: e2 } = await db.from(T.tokens).select("id").eq("id", tokenId).eq("team_id", teamId).maybeSingle();
    check(e2, "find token");
    if (!seen) throw new EnterpriseError("forbidden");
  },

  async setGroupRole(_userKey, teamId, groupId, role) {
    const db = await createRlsClient();
    const { data: g, error: e0 } = await db.from(T.groups).select("id").eq("id", groupId).eq("team_id", teamId).maybeSingle();
    check(e0, "find group");
    if (!g) throw new EnterpriseError("not_found");
    const { error } = await db.rpc("lifeos_set_group_role", { p_group: groupId, p_role: role });
    check(error, "group role");
  },

  /* ── Provisioning (service role, scoped by team) ───────────────────── */

  async resolveToken(tokenHash) {
    const db = createAdminClient();
    const { data, error } = await db.from(T.tokens).select("id, team_id, last_used_at").eq("token_hash", tokenHash).is("revoked_at", null).maybeSingle();
    if (error && isMissingTable(`${error.code ?? ""} ${error.message}`)) return null;
    check(error, "resolve token");
    if (!data) return null;
    return { teamId: data.team_id as string, tokenId: data.id as string, lastUsedAt: (data.last_used_at as string | null) ?? null };
  },

  async touchToken(tokenId) {
    const db = createAdminClient();
    const { error } = await db.from(T.tokens).update({ last_used_at: new Date().toISOString() }).eq("id", tokenId);
    check(error, "touch token");
  },

  async seats(teamId) {
    const db = createAdminClient();
    const { data, error } = await db.from(T.teams).select("seats").eq("id", teamId).maybeSingle();
    check(error, "seats");
    return Number(data?.seats ?? 0);
  },

  async users(teamId, where) {
    const db = createAdminClient();
    return all<DirectoryEntry>((from, to) => {
      let q = db.from(T.directory).select("*").eq("team_id", teamId);
      if (where?.userName !== undefined) q = q.ilike("user_name", exactly(where.userName));
      if (where?.externalId !== undefined) q = q.eq("external_id", where.externalId);
      return q.order("created_at").order("id").range(from, to);
    }, "users");
  },

  async user(teamId, id) {
    const db = createAdminClient();
    const { data, error } = await db.from(T.directory).select("*").eq("team_id", teamId).eq("id", id).maybeSingle();
    check(error, "user");
    return data ? fromRow<DirectoryEntry>(data) : null;
  },

  async createUser(teamId, input) {
    const db = createAdminClient();
    const { data, error } = await db.from(T.directory).insert(entryRow(teamId, input)).select("*").single();
    check(error, "create user");
    return fromRow<DirectoryEntry>(data);
  },

  async updateUser(teamId, id, input) {
    const db = createAdminClient();
    const { team_id: _t, ...patch } = entryRow(teamId, input);
    const { data, error } = await db
      .from(T.directory)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("team_id", teamId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    check(error, "update user");
    return data ? fromRow<DirectoryEntry>(data) : null;
  },

  async deleteUser(teamId, id) {
    const db = createAdminClient();
    const { data, error } = await db.from(T.directory).delete().eq("team_id", teamId).eq("id", id).select("id");
    check(error, "delete user");
    return !!data?.length;
  },

  async groups(teamId, where) {
    const db = createAdminClient();
    return all<DirectoryGroup>((from, to) => {
      let q = db.from(T.groups).select("*").eq("team_id", teamId);
      if (where?.displayName !== undefined) q = q.ilike("display_name", exactly(where.displayName));
      if (where?.externalId !== undefined) q = q.eq("external_id", where.externalId);
      return q.order("created_at").order("id").range(from, to);
    }, "groups");
  },

  async group(teamId, id) {
    const db = createAdminClient();
    const { data, error } = await db.from(T.groups).select("*").eq("team_id", teamId).eq("id", id).maybeSingle();
    check(error, "group");
    return data ? fromRow<DirectoryGroup>(data) : null;
  },

  async groupMembers(teamId, groupIds) {
    const db = createAdminClient();
    if (groupIds && groupIds.length === 0) return [];
    const lists = groupIds ? chunks(groupIds, 100) : [null];
    const out: GroupMember[] = [];
    for (const ids of lists) {
      out.push(
        ...(await all<GroupMember>((from, to) => {
          let q = db.from(T.groupMembers).select("*").eq("team_id", teamId);
          if (ids) q = q.in("group_id", ids);
          return q.order("group_id").order("entry_id").range(from, to);
        }, "group members"))
      );
    }
    return out;
  },

  async createGroup(teamId, input) {
    const db = createAdminClient();
    const { data, error } = await db
      .from(T.groups)
      .insert({ team_id: teamId, display_name: input.displayName, external_id: input.externalId })
      .select("*")
      .single();
    check(error, "create group");
    const g = fromRow<DirectoryGroup>(data);
    await setMembers(teamId, g.id, input.members);
    return g;
  },

  async updateGroup(teamId, id, input) {
    const db = createAdminClient();
    const { data, error } = await db
      .from(T.groups)
      .update({ display_name: input.displayName, external_id: input.externalId, updated_at: new Date().toISOString() })
      .eq("team_id", teamId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    check(error, "update group");
    if (!data) return null;
    await setMembers(teamId, id, input.members);
    return fromRow<DirectoryGroup>(data);
  },

  async deleteGroup(teamId, id) {
    const db = createAdminClient();
    const { data, error } = await db.from(T.groups).delete().eq("team_id", teamId).eq("id", id).select("id");
    check(error, "delete group");
    return !!data?.length;
  },
};

/** A group's members become exactly these entries of the team (others left out); the triggers follow. */
async function setMembers(teamId: string, groupId: string, ids: string[]): Promise<void> {
  const db = createAdminClient();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const wanted = [...new Set(ids.filter((x) => uuid.test(x)))];
  const valid = new Set<string>();
  for (const part of chunks(wanted, 100)) {
    const { data, error } = await db.from(T.directory).select("id").eq("team_id", teamId).in("id", part);
    check(error, "member ids");
    for (const r of data ?? []) valid.add(r.id as string);
  }
  const had = new Set((await supabaseEnterpriseStore.groupMembers(teamId, [groupId])).map((gm) => gm.entryId));
  const add = [...valid].filter((x) => !had.has(x));
  const drop = [...had].filter((x) => !valid.has(x));
  for (const part of chunks(drop, 100)) {
    const { error } = await db.from(T.groupMembers).delete().eq("group_id", groupId).in("entry_id", part);
    check(error, "drop members");
  }
  for (const part of chunks(add, 500)) {
    const { error } = await db.from(T.groupMembers).insert(part.map((entryId) => ({ group_id: groupId, entry_id: entryId, team_id: teamId })));
    check(error, "add members");
  }
}
