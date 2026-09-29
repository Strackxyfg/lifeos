"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, isSupabaseConfigured } from "@/lib/db/store";
import { getTeamStore } from "@/lib/team/store";
import { challengeName, challengeValue, checkDomain, normalizeDomain } from "@/lib/enterprise/domains";
import { getEnterpriseStore, newDomainToken, newScimToken, tokenHash } from "@/lib/enterprise/store";
import { createSamlProvider, deleteSamlProvider, updateSamlProvider } from "@/lib/enterprise/gotrue";
import { EnterpriseError, type EnterpriseErrorCode, type EnterpriseOverview } from "@/lib/enterprise/types";
import { appOrigin } from "@/lib/http/origin";

/**
 * A company team's enterprise settings, as actions. Each one: a signed-in
 * person (never the demo identity), the input checked here, the owner
 * checked through the store (Postgres' policies and functions, or the file
 * store's rules) — and the two things only the server may conclude, that a
 * DNS record is there and that Supabase Auth registered a provider, written
 * by the server alone after it saw them.
 */

export type EnterpriseActionCode =
  | EnterpriseErrorCode
  | "unauthorized"
  | "migration_pending"
  | "failed"
  | "public_domain"
  | "dns_missing"
  | "dns_error"
  | "no_verified_domain"
  | "sso_unavailable"
  | "sso_rejected"
  | "sso_connected";
export type EnterpriseResult<T> = { ok: true; data: T } | { ok: false; code: EnterpriseActionCode; detail?: string };

const fail = (code: EnterpriseActionCode, detail?: string): EnterpriseResult<never> => ({ ok: false, code, ...(detail ? { detail } : {}) });
const id = z.string().trim().min(1).max(64);

async function actor(): Promise<{ userKey: string } | EnterpriseResult<never>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  if (!(await getTeamStore().supportsTeams()) || !(await getEnterpriseStore().supportsEnterprise())) return fail("migration_pending");
  return { userKey };
}

/** The team as its owner sees it — or why the caller may not act on it. */
async function owned(userKey: string, teamId: string): Promise<EnterpriseOverview | EnterpriseResult<never>> {
  const o = await getEnterpriseStore().overview(userKey, teamId);
  if (!o) return fail("not_found");
  if (o.role !== "owner") return fail("forbidden");
  return o;
}

function failure(err: unknown): EnterpriseResult<never> {
  if (err instanceof EnterpriseError) return fail(err.code);
  if (err instanceof Error && err.name === "MigrationPending") return fail("migration_pending");
  console.error("[enterprise]", err);
  return fail("failed");
}

function refresh(teamId: string) {
  revalidatePath(`/team/${teamId}`);
}

const verifiedDomains = (o: EnterpriseOverview) => o.domains.filter((d) => d.verifiedAt).map((d) => d.domain);

/* ── Domains ──────────────────────────────────────────────────────── */

export async function claimDomain(teamId: unknown, domain: unknown): Promise<EnterpriseResult<{ id: string; name: string; value: string }>> {
  const t = id.safeParse(teamId);
  const d = z.string().max(300).safeParse(domain);
  if (!t.success || !d.success) return fail("invalid");
  const n = normalizeDomain(d.data);
  if (!n.ok) return fail(n.problem === "public" ? "public_domain" : "invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const row = await getEnterpriseStore().claimDomain(a.userKey, t.data, n.domain, newDomainToken());
    refresh(t.data);
    return { ok: true, data: { id: row.id, name: challengeName(row.domain), value: challengeValue(row.token) } };
  } catch (err) {
    return failure(err);
  }
}

export async function verifyDomain(teamId: unknown, domainId: unknown): Promise<EnterpriseResult<{ domain: string }>> {
  const t = id.safeParse(teamId);
  const d = id.safeParse(domainId);
  if (!t.success || !d.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const o = await owned(a.userKey, t.data);
    if ("ok" in o) return o;
    const row = o.domains.find((x) => x.id === d.data);
    if (!row) return fail("not_found");
    if (row.verifiedAt) return { ok: true, data: { domain: row.domain } };
    const check = await checkDomain(row.domain, row.token);
    if (check.state === "missing") return fail("dns_missing");
    if (check.state === "error") return fail("dns_error", check.code);
    const store = getEnterpriseStore();
    await store.markDomainVerified(t.data, row.id);
    refresh(t.data);
    // A connected provider learns the new domain, so its people can find it by address.
    if (o.sso) {
      const up = await updateSamlProvider(o.sso.providerId, { domains: [...verifiedDomains(o), row.domain] });
      if (!up.ok) return fail("sso_rejected", up.message);
    }
    return { ok: true, data: { domain: row.domain } };
  } catch (err) {
    return failure(err);
  }
}

export async function removeDomain(teamId: unknown, domainId: unknown): Promise<EnterpriseResult<null>> {
  const t = id.safeParse(teamId);
  const d = id.safeParse(domainId);
  if (!t.success || !d.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const o = await owned(a.userKey, t.data);
    if ("ok" in o) return o;
    const row = o.domains.find((x) => x.id === d.data);
    if (!row) return fail("not_found");
    if (o.sso && row.verifiedAt) {
      const rest = verifiedDomains(o).filter((x) => x !== row.domain);
      // Single sign-on is found by domain: the last one goes with it, not before.
      if (rest.length === 0) return fail("sso_connected");
      const up = await updateSamlProvider(o.sso.providerId, { domains: rest });
      if (!up.ok) return fail("sso_rejected", up.message);
    }
    await getEnterpriseStore().removeDomain(a.userKey, t.data, row.id);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── Single sign-on ───────────────────────────────────────────────── */

const metadataSchema = z.union([
  z.object({ metadataUrl: z.string().trim().url().max(2048).refine((u) => u.startsWith("https://")), metadataXml: z.undefined().optional() }),
  z.object({ metadataXml: z.string().trim().min(20).max(500_000).refine((x) => x.startsWith("<")), metadataUrl: z.undefined().optional() }),
]);

export async function connectSso(teamId: unknown, input: unknown): Promise<EnterpriseResult<{ providerId: string }>> {
  const t = id.safeParse(teamId);
  const p = metadataSchema.safeParse(input);
  if (!t.success || !p.success) return fail("invalid");
  if (!isSupabaseConfigured()) return fail("sso_unavailable");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const o = await owned(a.userKey, t.data);
    if ("ok" in o) return o;
    const domains = verifiedDomains(o);
    if (domains.length === 0) return fail("no_verified_domain");
    const store = getEnterpriseStore();

    if (o.sso) {
      // Already connected: new metadata (a rotated certificate), same provider.
      const up = await updateSamlProvider(o.sso.providerId, { ...p.data, domains });
      if (!up.ok) return fail(up.code === "unavailable" ? "sso_unavailable" : "sso_rejected", up.message);
      await store.linkSso(t.data, { providerId: o.sso.providerId, metadataUrl: p.data.metadataUrl ?? null, createdBy: o.sso.createdBy });
      refresh(t.data);
      return { ok: true, data: { providerId: o.sso.providerId } };
    }

    const created = await createSamlProvider({ ...p.data, domains });
    if (!created.ok) return fail(created.code === "unavailable" ? "sso_unavailable" : "sso_rejected", created.message);
    try {
      await store.linkSso(t.data, { providerId: created.data.id, metadataUrl: p.data.metadataUrl ?? null, createdBy: a.userKey });
    } catch (err) {
      // Not linked: the provider must not stay registered with nobody to answer for it.
      await deleteSamlProvider(created.data.id);
      throw err;
    }
    refresh(t.data);
    return { ok: true, data: { providerId: created.data.id } };
  } catch (err) {
    return failure(err);
  }
}

export async function disconnectSso(teamId: unknown): Promise<EnterpriseResult<null>> {
  const t = id.safeParse(teamId);
  if (!t.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const o = await owned(a.userKey, t.data);
    if ("ok" in o) return o;
    if (!o.sso) return { ok: true, data: null };
    const gone = await deleteSamlProvider(o.sso.providerId);
    if (!gone.ok) return fail(gone.code === "unavailable" ? "sso_unavailable" : "sso_rejected", gone.message);
    await getEnterpriseStore().unlinkSso(t.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function setSsoOptions(teamId: unknown, input: unknown): Promise<EnterpriseResult<null>> {
  const t = id.safeParse(teamId);
  const p = z.object({ jit: z.boolean().optional(), enforce: z.boolean().optional() }).safeParse(input);
  if (!t.success || !p.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getEnterpriseStore().setSsoOptions(a.userKey, t.data, p.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── Provisioning ─────────────────────────────────────────────────── */

export async function createScimToken(teamId: unknown, label: unknown): Promise<EnterpriseResult<{ token: string; url: string }>> {
  const t = id.safeParse(teamId);
  const l = z.string().trim().min(1).max(80).safeParse(label);
  if (!t.success || !l.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const token = newScimToken();
    await getEnterpriseStore().createScimToken(a.userKey, t.data, l.data, tokenHash(token));
    refresh(t.data);
    return { ok: true, data: { token, url: `${await appOrigin()}/api/scim/v2` } };
  } catch (err) {
    return failure(err);
  }
}

export async function revokeScimToken(teamId: unknown, tokenId: unknown): Promise<EnterpriseResult<null>> {
  const t = id.safeParse(teamId);
  const k = id.safeParse(tokenId);
  if (!t.success || !k.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getEnterpriseStore().revokeScimToken(a.userKey, t.data, k.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function setGroupRole(teamId: unknown, groupId: unknown, role: unknown): Promise<EnterpriseResult<null>> {
  const t = id.safeParse(teamId);
  const g = id.safeParse(groupId);
  const r = z.enum(["member", "admin"]).safeParse(role);
  if (!t.success || !g.success || !r.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getEnterpriseStore().setGroupRole(a.userKey, t.data, g.data, r.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}
