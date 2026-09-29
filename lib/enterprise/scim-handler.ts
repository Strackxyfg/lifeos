import { createHash } from "node:crypto";
import {
  ScimError,
  applyGroupPatch,
  applyUserPatch,
  entryFromScim,
  errorBody,
  groupFromScim,
  groupResource,
  listResponse,
  matches,
  paging,
  parseFilter,
  patchOps,
  project,
  resourceTypes,
  schemas,
  serviceProviderConfig,
  simpleEq,
  userResource,
  type Filter,
} from "./scim";
import { EnterpriseError, type DirectoryEntry, type DirectoryGroup, type DirectoryStore, type EntryInput } from "./types";

/**
 * One SCIM request, from bearer token to response — the whole endpoint
 * except HTTP plumbing (the route) and storage (the store), so it can be
 * run end to end in a test.
 */

export interface ScimRequest {
  method: string;
  /** The path after /api/scim/v2, split: ["Users", "<id>"]. */
  segments: string[];
  params: URLSearchParams;
  body: unknown;
  authorization: string | null;
  /** Absolute URL of /api/scim/v2, for resource locations. */
  base: string;
}

export interface ScimResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const TOKEN = /^lifeos_scim_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How stale "last used" may get before it is written again: one write per token per five minutes. */
const TOUCH_EVERY_MS = 5 * 60_000;

const ok = (status: number, body?: unknown, headers?: Record<string, string>): ScimResponse => ({ status, body, headers });
const fail = (err: ScimError): ScimResponse => ({
  status: err.status,
  body: errorBody(err),
  headers: err.status === 401 ? { "WWW-Authenticate": 'Bearer realm="LifeOS SCIM"' } : undefined,
});
const notFound = (what: string) => new ScimError(404, `${what} not found.`);
function found<X>(x: X | undefined, what: string): X {
  if (x === undefined) throw notFound(what);
  return x;
}

export async function handleScim(req: ScimRequest, store: DirectoryStore): Promise<ScimResponse> {
  try {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.authorization ?? "");
    if (!m || !TOKEN.test(m[1])) throw new ScimError(401, "A provisioning token is required (Authorization: Bearer lifeos_scim_…).");
    const auth = await store.resolveToken(createHash("sha256").update(m[1]).digest("hex"));
    if (!auth) throw new ScimError(401, "This provisioning token is not valid, or was revoked.");
    if (!auth.lastUsedAt || Date.now() - Date.parse(auth.lastUsedAt) > TOUCH_EVERY_MS) await store.touchToken(auth.tokenId);
    return await route(req, store, auth.teamId);
  } catch (err) {
    if (err instanceof ScimError) return fail(err);
    if (err instanceof EnterpriseError) {
      if (err.code === "conflict") return fail(new ScimError(409, `A resource with this ${err.message === "conflict" ? "name" : err.message} already exists.`, "uniqueness"));
      if (err.code === "invalid") return fail(new ScimError(400, "A value is not valid.", "invalidValue"));
      if (err.code === "not_found") return fail(notFound("Resource"));
    }
    console.error("[scim]", err);
    return fail(new ScimError(500, "The request could not be completed."));
  }
}

async function route(req: ScimRequest, store: DirectoryStore, teamId: string): Promise<ScimResponse> {
  const [resource = "", id, ...rest] = req.segments;
  const kind = resource.toLowerCase();
  const method = req.method.toUpperCase();
  if (rest.length) throw notFound("Endpoint");
  const only = (allowed: string[]) => {
    if (!allowed.includes(method)) throw new ScimError(405, `${method} is not supported here.`);
  };

  switch (kind) {
    case "serviceproviderconfig":
      only(["GET"]);
      if (id) throw notFound("Endpoint");
      return ok(200, serviceProviderConfig(req.base));
    case "resourcetypes": {
      only(["GET"]);
      const all = resourceTypes(req.base);
      if (id) return ok(200, found(all.find((r) => r.id.toLowerCase() === id.toLowerCase()), "Resource type"));
      return ok(200, listResponse(all, all.length, 1));
    }
    case "schemas": {
      only(["GET"]);
      const all = schemas(req.base);
      if (id) return ok(200, found(all.find((s) => s.id === id), "Schema"));
      return ok(200, listResponse(all, all.length, 1));
    }
    case "users":
      return id ? userById(req, store, teamId, id, method) : users(req, store, teamId, method);
    case "groups":
      return id ? groupById(req, store, teamId, id, method) : groups(req, store, teamId, method);
    case "bulk":
    case "me":
      throw new ScimError(501, `/${resource} is not supported.`);
    default:
      throw notFound("Endpoint");
  }
}

/* ── Users ────────────────────────────────────────────────────────── */

const inputOf = (e: DirectoryEntry): EntryInput => ({
  userName: e.userName,
  externalId: e.externalId,
  email: e.email,
  givenName: e.givenName,
  familyName: e.familyName,
  displayName: e.displayName,
  title: e.title,
  active: e.active,
});

/** Each user's groups, for the read-only `groups` attribute. */
async function groupsByUser(store: DirectoryStore, teamId: string): Promise<Map<string, Pick<DirectoryGroup, "id" | "displayName">[]>> {
  const [gs, gms] = await Promise.all([store.groups(teamId), store.groupMembers(teamId)]);
  const byId = new Map(gs.map((g) => [g.id, g]));
  const out = new Map<string, Pick<DirectoryGroup, "id" | "displayName">[]>();
  for (const gm of gms) {
    const g = byId.get(gm.groupId);
    if (!g) continue;
    out.set(gm.entryId, [...(out.get(gm.entryId) ?? []), { id: g.id, displayName: g.displayName }]);
  }
  return out;
}

async function userOut(store: DirectoryStore, teamId: string, e: DirectoryEntry, base: string) {
  return userResource(e, (await groupsByUser(store, teamId)).get(e.id) ?? [], base);
}

function filterOf(params: URLSearchParams): Filter | null {
  const raw = params.get("filter");
  return raw && raw.trim() ? parseFilter(raw) : null;
}

async function users(req: ScimRequest, store: DirectoryStore, teamId: string, method: string): Promise<ScimResponse> {
  if (method === "POST") {
    const created = await store.createUser(teamId, entryFromScim(req.body));
    const body = await userOut(store, teamId, created, req.base);
    return ok(201, body, { Location: `${req.base}/Users/${created.id}` });
  }
  if (method !== "GET") throw new ScimError(405, `${method} is not supported on /Users.`);
  const filter = filterOf(req.params);
  const eq = simpleEq(filter, ["username", "externalid"]);
  const list = await store.users(teamId, eq ? (eq.attr === "username" ? { userName: eq.value } : { externalId: eq.value }) : undefined);
  const grouped = await groupsByUser(store, teamId);
  const resources = list.map((e) => userResource(e, grouped.get(e.id) ?? [], req.base)).filter((r) => !filter || matches(r, filter));
  const { start, count } = paging(req.params);
  const page = resources.slice(start - 1, start - 1 + count).map((r) => project(r, req.params));
  return ok(200, listResponse(page, resources.length, start));
}

async function userById(req: ScimRequest, store: DirectoryStore, teamId: string, id: string, method: string): Promise<ScimResponse> {
  if (!UUID.test(id)) throw notFound("User");
  const current = await store.user(teamId, id);
  if (!current) throw notFound("User");
  switch (method) {
    case "GET":
      return ok(200, project(await userOut(store, teamId, current, req.base), req.params));
    case "PUT": {
      const next = await store.updateUser(teamId, id, entryFromScim(req.body));
      if (!next) throw notFound("User");
      return ok(200, await userOut(store, teamId, next, req.base));
    }
    case "PATCH": {
      const next = await store.updateUser(teamId, id, applyUserPatch(inputOf(current), patchOps(req.body)));
      if (!next) throw notFound("User");
      return ok(200, await userOut(store, teamId, next, req.base));
    }
    case "DELETE":
      await store.deleteUser(teamId, id);
      return ok(204);
    default:
      throw new ScimError(405, `${method} is not supported on a User.`);
  }
}

/* ── Groups ───────────────────────────────────────────────────────── */

const wantsMembers = (params: URLSearchParams) => {
  const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim().toLowerCase());
  const only = params.get("attributes");
  if (only) return list(only).includes("members");
  return !list(params.get("excludedAttributes")).includes("members");
};

async function groupOut(store: DirectoryStore, teamId: string, groupsList: DirectoryGroup[], base: string, withMembers: boolean) {
  if (!withMembers) return groupsList.map((g) => groupResource(g, [], base, false));
  const [gms, entries] = await Promise.all([store.groupMembers(teamId, groupsList.map((g) => g.id)), store.users(teamId)]);
  const byId = new Map(entries.map((e) => [e.id, e]));
  return groupsList.map((g) =>
    groupResource(
      g,
      gms.filter((gm) => gm.groupId === g.id).map((gm) => byId.get(gm.entryId)).filter((e): e is DirectoryEntry => !!e),
      base
    )
  );
}

async function groups(req: ScimRequest, store: DirectoryStore, teamId: string, method: string): Promise<ScimResponse> {
  if (method === "POST") {
    const created = await store.createGroup(teamId, groupFromScim(req.body));
    const [body] = await groupOut(store, teamId, [created], req.base, true);
    return ok(201, body, { Location: `${req.base}/Groups/${created.id}` });
  }
  if (method !== "GET") throw new ScimError(405, `${method} is not supported on /Groups.`);
  const filter = filterOf(req.params);
  const eq = simpleEq(filter, ["displayname", "externalid"]);
  const list = await store.groups(teamId, eq ? (eq.attr === "displayname" ? { displayName: eq.value } : { externalId: eq.value }) : undefined);
  // A filter on members needs them, whatever the projection says.
  const needMembers = wantsMembers(req.params) || JSON.stringify(filter ?? {}).includes('"members"');
  const resources = (await groupOut(store, teamId, list, req.base, needMembers)).filter((r) => !filter || matches(r, filter));
  const { start, count } = paging(req.params);
  const page = resources.slice(start - 1, start - 1 + count).map((r) => project(r, req.params));
  return ok(200, listResponse(page, resources.length, start));
}

async function groupById(req: ScimRequest, store: DirectoryStore, teamId: string, id: string, method: string): Promise<ScimResponse> {
  if (!UUID.test(id)) throw notFound("Group");
  const current = await store.group(teamId, id);
  if (!current) throw notFound("Group");
  switch (method) {
    case "GET": {
      const [body] = await groupOut(store, teamId, [current], req.base, wantsMembers(req.params));
      return ok(200, project(body, req.params));
    }
    case "PUT": {
      const next = await store.updateGroup(teamId, id, groupFromScim(req.body));
      if (!next) throw notFound("Group");
      const [body] = await groupOut(store, teamId, [next], req.base, true);
      return ok(200, body);
    }
    case "PATCH": {
      const members = (await store.groupMembers(teamId, [id])).map((gm) => gm.entryId);
      const next = applyGroupPatch({ displayName: current.displayName, externalId: current.externalId, members }, patchOps(req.body));
      if (!(await store.updateGroup(teamId, id, next))) throw notFound("Group");
      return ok(204);
    }
    case "DELETE":
      await store.deleteGroup(teamId, id);
      return ok(204);
    default:
      throw new ScimError(405, `${method} is not supported on a Group.`);
  }
}
