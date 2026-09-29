import type { DirectoryEntry, DirectoryGroup, EntryInput, GroupInput } from "./types";

/**
 * SCIM 2.0 (RFC 7643, RFC 7644) as LifeOS speaks it: the wire format, the
 * filter language, PATCH — nothing about storage. What Microsoft Entra ID
 * and Okta actually send is taken as it comes: "Replace" as well as
 * "replace", `active` as "False", path-less values with dotted keys, a
 * group's members removed by value list or by filter.
 *
 * Attributes LifeOS does not keep (phone numbers, addresses, the
 * enterprise extension…) are accepted and ignored: refusing them would
 * fail the provider's whole sync for a field nobody here reads.
 */

export const SCHEMA = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  enterprise: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
  spc: "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
  resourceType: "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
  schema: "urn:ietf:params:scim:schemas:core:2.0:Schema",
} as const;

export const MAX_PAGE = 200;
export const LIMIT = { userName: 320, externalId: 256, email: 320, name: 200, title: 200, groupName: 256, groupMembers: 10_000 } as const;

export type ScimType = "invalidFilter" | "invalidPath" | "invalidValue" | "invalidSyntax" | "uniqueness" | "mutability" | "noTarget" | "tooMany";

export class ScimError extends Error {
  constructor(readonly status: number, readonly detail: string, readonly scimType?: ScimType) {
    super(detail);
    this.name = "ScimError";
  }
}

export function errorBody(err: ScimError) {
  return { schemas: [SCHEMA.error], status: String(err.status), ...(err.scimType ? { scimType: err.scimType } : {}), detail: err.detail };
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Drops undefined and null members, so a resource carries only what it has. */
function pruned<T extends Obj>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;
}

/* ── Filters (RFC 7644 §3.4.2.2) ──────────────────────────────────── */

export type CompareOp = "eq" | "ne" | "co" | "sw" | "ew" | "gt" | "ge" | "lt" | "le";
export type Filter =
  | { kind: "cmp"; path: string[]; op: CompareOp; value: string | number | boolean | null }
  | { kind: "pr"; path: string[] }
  | { kind: "and" | "or"; left: Filter; right: Filter }
  | { kind: "not"; inner: Filter }
  | { kind: "any"; path: string[]; inner: Filter };

const OPS = new Set(["eq", "ne", "co", "sw", "ew", "gt", "ge", "lt", "le"]);

type Tok = { t: "(" | ")" | "[" | "]" } | { t: "word"; v: string } | { t: "str"; v: string } | { t: "num"; v: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "(" || c === ")" || c === "[" || c === "]") {
      out.push({ t: c });
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      if (j >= src.length) throw new ScimError(400, "Unterminated string in filter.", "invalidFilter");
      try {
        out.push({ t: "str", v: JSON.parse(src.slice(i, j + 1)) as string });
      } catch {
        throw new ScimError(400, "Malformed string in filter.", "invalidFilter");
      }
      i = j + 1;
    } else if (/[-0-9]/.test(c)) {
      const m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ScimError(400, "Malformed number in filter.", "invalidFilter");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else {
      const m = /^[A-Za-z_$][\w:.$-]*/.exec(src.slice(i));
      if (!m) throw new ScimError(400, `Unexpected "${c}" in filter.`, "invalidFilter");
      out.push({ t: "word", v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

/** "urn:…:core:2.0:User:name.givenName" → ["name", "givenname"] (lower-cased). */
export function attrPath(raw: string): string[] {
  let p = raw;
  if (/^urn:/i.test(p)) {
    const i = p.lastIndexOf(":");
    p = p.slice(i + 1);
  }
  return p.split(".").filter(Boolean).map((s) => s.toLowerCase());
}

export function parseFilter(src: string): Filter {
  if (src.length > 2000) throw new ScimError(400, "Filter too long.", "invalidFilter");
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const word = (v: string) => {
    const t = toks[i];
    return !!t && t.t === "word" && t.v.toLowerCase() === v;
  };

  const orExpr = (): Filter => {
    let left = andExpr();
    while (word("or")) {
      i++;
      left = { kind: "or", left, right: andExpr() };
    }
    return left;
  };
  const andExpr = (): Filter => {
    let left = unary();
    while (word("and")) {
      i++;
      left = { kind: "and", left, right: unary() };
    }
    return left;
  };
  const unary = (): Filter => {
    if (word("not")) {
      i++;
      if (peek()?.t !== "(") throw new ScimError(400, "Expected ( after not.", "invalidFilter");
      return { kind: "not", inner: unary() };
    }
    if (peek()?.t === "(") {
      i++;
      const inner = orExpr();
      if (peek()?.t !== ")") throw new ScimError(400, "Expected ).", "invalidFilter");
      i++;
      return inner;
    }
    const t = toks[i++];
    if (!t || t.t !== "word") throw new ScimError(400, "Expected an attribute.", "invalidFilter");
    const path = attrPath(t.v);
    if (peek()?.t === "[") {
      i++;
      const inner = orExpr();
      if (peek()?.t !== "]") throw new ScimError(400, "Expected ].", "invalidFilter");
      i++;
      return { kind: "any", path, inner };
    }
    const opTok = toks[i++];
    if (!opTok || opTok.t !== "word") throw new ScimError(400, "Expected an operator.", "invalidFilter");
    const op = opTok.v.toLowerCase();
    if (op === "pr") return { kind: "pr", path };
    if (!OPS.has(op)) throw new ScimError(400, `Unknown operator "${opTok.v}".`, "invalidFilter");
    const vt = toks[i++];
    let value: string | number | boolean | null;
    if (vt?.t === "str" || vt?.t === "num") value = vt.v;
    else if (vt?.t === "word" && ["true", "false", "null"].includes(vt.v.toLowerCase())) value = vt.v.toLowerCase() === "null" ? null : vt.v.toLowerCase() === "true";
    else throw new ScimError(400, "Expected a value.", "invalidFilter");
    return { kind: "cmp", path, op: op as CompareOp, value };
  };

  const f = orExpr();
  if (i !== toks.length) throw new ScimError(400, "Unexpected text at the end of the filter.", "invalidFilter");
  return f;
}

function lookup(o: Obj, key: string): unknown {
  for (const k of Object.keys(o)) if (k.toLowerCase() === key) return o[k];
  return undefined;
}

/** Every value at a path; a multi-valued attribute contributes each element's. */
function valuesAt(node: unknown, path: string[]): unknown[] {
  if (node === undefined || node === null) return [];
  if (Array.isArray(node)) return node.flatMap((n) => valuesAt(n, path));
  if (path.length === 0) return [node];
  if (!isObj(node)) return [];
  return valuesAt(lookup(node, path[0]), path.slice(1));
}

// Identifiers compare exactly; everything else as SCIM's default, case-insensitively.
const CASE_EXACT = new Set(["id", "externalid", "value", "$ref"]);

function compare(actual: unknown, op: CompareOp, expected: string | number | boolean | null, exact: boolean): boolean {
  // A complex value (an email) compares by its "value".
  const a = isObj(actual) ? lookup(actual, "value") : actual;
  if (expected === null) return op === "eq" ? a === null || a === undefined : op === "ne" ? a !== null && a !== undefined : false;
  if (typeof expected === "boolean") {
    const b = typeof a === "string" ? a.toLowerCase() === "true" : a;
    return op === "eq" ? b === expected : op === "ne" ? b !== expected : false;
  }
  if (typeof expected === "number") {
    const n = typeof a === "number" ? a : Number(a);
    if (Number.isNaN(n)) return op === "ne";
    return { eq: n === expected, ne: n !== expected, gt: n > expected, ge: n >= expected, lt: n < expected, le: n <= expected, co: false, sw: false, ew: false }[op];
  }
  if (typeof a !== "string") return op === "ne";
  const x = exact ? a : a.toLowerCase();
  const y = exact ? expected : expected.toLowerCase();
  switch (op) {
    case "eq": return x === y;
    case "ne": return x !== y;
    case "co": return x.includes(y);
    case "sw": return x.startsWith(y);
    case "ew": return x.endsWith(y);
    case "gt": return x > y;
    case "ge": return x >= y;
    case "lt": return x < y;
    case "le": return x <= y;
  }
}

/** Whether a resource (as LifeOS writes it) matches a filter. */
export function matches(resource: unknown, f: Filter): boolean {
  switch (f.kind) {
    case "and": return matches(resource, f.left) && matches(resource, f.right);
    case "or": return matches(resource, f.left) || matches(resource, f.right);
    case "not": return !matches(resource, f.inner);
    case "pr": return valuesAt(resource, f.path).some((v) => v !== "" && !(Array.isArray(v) && v.length === 0));
    case "any": return valuesAt(resource, f.path).some((el) => matches(el, f.inner));
    case "cmp": {
      const vals = valuesAt(resource, f.path);
      const exact = CASE_EXACT.has(f.path[f.path.length - 1] ?? "");
      if (vals.length === 0) return f.op === "ne" ? f.value !== null : f.op === "eq" && f.value === null;
      return f.op === "ne" ? vals.every((v) => compare(v, "ne", f.value, exact)) : vals.some((v) => compare(v, f.op, f.value, exact));
    }
  }
}

/** A filter that is one `attr eq "text"` — which a store can look up directly. */
export function simpleEq(f: Filter | null, attrs: string[]): { attr: string; value: string } | null {
  if (!f || f.kind !== "cmp" || f.op !== "eq" || typeof f.value !== "string" || f.path.length !== 1) return null;
  return attrs.includes(f.path[0]) ? { attr: f.path[0], value: f.value } : null;
}

/* ── Paging and projection ────────────────────────────────────────── */

export function paging(params: URLSearchParams): { start: number; count: number } {
  const n = (v: string | null, d: number) => (v !== null && /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : d);
  // RFC 7644 §3.4.2.4: below 1 is taken as 1; a negative count as 0.
  return { start: Math.max(1, n(params.get("startIndex"), 1)), count: Math.min(MAX_PAGE, Math.max(0, n(params.get("count"), 100))) };
}

export function listResponse(resources: unknown[], total: number, start: number) {
  return { schemas: [SCHEMA.list], totalResults: total, startIndex: start, itemsPerPage: resources.length, Resources: resources };
}

/**
 * `attributes` / `excludedAttributes`, at the top level (what Entra asks:
 * `excludedAttributes=members`). id, schemas and meta always stay.
 */
export function project(resource: Obj, params: URLSearchParams): Obj {
  const list = (v: string | null) => (v ? v.split(",").map((s) => attrPath(s.trim())[0]).filter(Boolean) : []);
  const only = list(params.get("attributes"));
  const without = list(params.get("excludedAttributes"));
  const keep = new Set(["id", "schemas", "meta"]);
  return Object.fromEntries(
    Object.entries(resource).filter(([k]) => {
      const key = k.toLowerCase();
      if (keep.has(key)) return true;
      if (only.length) return only.includes(key);
      return !without.includes(key);
    })
  );
}

/* ── Users ────────────────────────────────────────────────────────── */

export function userResource(e: DirectoryEntry, groups: Pick<DirectoryGroup, "id" | "displayName">[], base: string): Obj {
  const formatted = [e.givenName, e.familyName].filter(Boolean).join(" ") || null;
  const name = pruned({ givenName: e.givenName, familyName: e.familyName, formatted });
  return pruned({
    schemas: [SCHEMA.user],
    id: e.id,
    externalId: e.externalId,
    userName: e.userName,
    name: Object.keys(name).length ? name : null,
    displayName: e.displayName,
    title: e.title,
    emails: e.email ? [{ value: e.email, type: "work", primary: true }] : null,
    active: e.active,
    groups: groups.length ? groups.map((g) => ({ value: g.id, display: g.displayName, $ref: `${base}/Groups/${g.id}` })) : null,
    meta: {
      resourceType: "User",
      created: e.createdAt,
      lastModified: e.updatedAt,
      location: `${base}/Users/${e.id}`,
      version: `W/"${Date.parse(e.updatedAt) || 0}"`,
    },
  });
}

/** The user as a mutable document, in the shape PATCH paths address. */
interface UserDoc {
  userName: string | null;
  externalId: string | null;
  name: { givenName: string | null; familyName: string | null };
  displayName: string | null;
  title: string | null;
  emails: { value: string; type: string | null; primary: boolean }[];
  active: boolean;
}

function toDoc(e: EntryInput): UserDoc {
  return {
    userName: e.userName,
    externalId: e.externalId,
    name: { givenName: e.givenName, familyName: e.familyName },
    displayName: e.displayName,
    title: e.title,
    emails: e.email ? [{ value: e.email, type: "work", primary: true }] : [],
    active: e.active,
  };
}

function text(v: unknown, max: number, what: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number") throw new ScimError(400, `${what} must be a string.`, "invalidValue");
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new ScimError(400, `${what} is longer than ${max} characters.`, "invalidValue");
  return s;
}

/** SCIM booleans, including Entra's "True" / "False". */
function bool(v: unknown, what: string): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === "true";
  throw new ScimError(400, `${what} must be true or false.`, "invalidValue");
}

function emailList(v: unknown): UserDoc["emails"] {
  const arr = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  return arr
    .map((x) => (isObj(x) ? x : { value: x }))
    .map((x) => ({
      value: text(lookup(x, "value"), LIMIT.email, "emails.value") ?? "",
      type: text(lookup(x, "type"), 40, "emails.type"),
      primary: lookup(x, "primary") === undefined ? false : bool(lookup(x, "primary"), "emails.primary"),
    }))
    .filter((x) => x.value);
}

function fromDoc(d: UserDoc): EntryInput {
  const userName = text(d.userName, LIMIT.userName, "userName");
  if (!userName) throw new ScimError(400, "userName is required.", "invalidValue");
  const email = (d.emails.find((x) => x.primary) ?? d.emails.find((x) => x.type === "work") ?? d.emails[0])?.value ?? null;
  return {
    userName,
    externalId: text(d.externalId, LIMIT.externalId, "externalId"),
    email: text(email, LIMIT.email, "email"),
    givenName: text(d.name.givenName, LIMIT.name, "name.givenName"),
    familyName: text(d.name.familyName, LIMIT.name, "name.familyName"),
    displayName: text(d.displayName, LIMIT.name, "displayName"),
    title: text(d.title, LIMIT.title, "title"),
    active: d.active,
  };
}

/** Sets one top-level attribute of a user document; unknown ones are ignored. */
function setUserAttr(d: UserDoc, key: string, value: unknown, op: "add" | "replace") {
  switch (key) {
    case "username": d.userName = text(value, LIMIT.userName, "userName"); break;
    case "externalid": d.externalId = text(value, LIMIT.externalId, "externalId"); break;
    case "displayname": d.displayName = text(value, LIMIT.name, "displayName"); break;
    case "title": d.title = text(value, LIMIT.title, "title"); break;
    case "active": d.active = bool(value, "active"); break;
    case "name":
      if (value === null) d.name = { givenName: null, familyName: null };
      else if (isObj(value)) {
        // A complex attribute: the given sub-attributes replace, the others stay.
        const g = lookup(value, "givenname");
        const f = lookup(value, "familyname");
        if (g !== undefined) d.name.givenName = text(g, LIMIT.name, "name.givenName");
        if (f !== undefined) d.name.familyName = text(f, LIMIT.name, "name.familyName");
      } else throw new ScimError(400, "name must be an object.", "invalidValue");
      break;
    case "emails": {
      const list = emailList(value);
      if (op === "replace") d.emails = list;
      else for (const e of list) if (!d.emails.some((x) => x.value.toLowerCase() === e.value.toLowerCase())) d.emails.push(e);
      break;
    }
    default:
      break; // not kept here (phoneNumbers, addresses, locale, the enterprise extension…)
  }
}

export interface PatchOp {
  op: "add" | "replace" | "remove";
  path: string | null;
  value: unknown;
}

/** The operations of a PatchOp message, validated and with their op lower-cased. */
export function patchOps(body: unknown): PatchOp[] {
  if (!isObj(body)) throw new ScimError(400, "The body must be a JSON object.", "invalidSyntax");
  const ops = lookup(body, "operations");
  if (!Array.isArray(ops) || ops.length === 0) throw new ScimError(400, "Operations is required.", "invalidSyntax");
  if (ops.length > 1000) throw new ScimError(400, "Too many operations.", "tooMany");
  return ops.map((o) => {
    if (!isObj(o)) throw new ScimError(400, "Each operation must be an object.", "invalidSyntax");
    const op = String(lookup(o, "op") ?? "").toLowerCase();
    if (op !== "add" && op !== "replace" && op !== "remove") throw new ScimError(400, `Unknown op "${String(lookup(o, "op"))}".`, "invalidSyntax");
    const path = lookup(o, "path");
    if (path !== undefined && path !== null && typeof path !== "string") throw new ScimError(400, "path must be a string.", "invalidPath");
    return { op, path: typeof path === "string" && path.trim() ? path.trim() : null, value: lookup(o, "value") };
  });
}

/**
 * A PATCH path: an attribute path ("name.givenName"), or an attribute with
 * a value filter and an optional sub-attribute ('emails[type eq "work"].value').
 */
function parsePath(raw: string): { attr: string[]; filter: Filter | null; sub: string | null } {
  const m = /^([^[\]]+?)(?:\[(.*)\](?:\.([A-Za-z0-9_$-]+))?)?$/.exec(raw);
  if (!m) throw new ScimError(400, `Invalid path "${raw}".`, "invalidPath");
  const filter = m[2] !== undefined ? parseFilter(m[2]) : null;
  const attr = attrPath(m[1]);
  if (attr.length === 0) throw new ScimError(400, `Invalid path "${raw}".`, "invalidPath");
  return { attr, filter, sub: m[3]?.toLowerCase() ?? null };
}

/** True for a path into an extension schema LifeOS does not keep. */
function foreignSchema(raw: string): boolean {
  return /^urn:/i.test(raw) && !raw.toLowerCase().startsWith(SCHEMA.user.toLowerCase() + ":") && !raw.toLowerCase().startsWith(SCHEMA.group.toLowerCase() + ":");
}

export function applyUserPatch(current: EntryInput, ops: PatchOp[]): EntryInput {
  const d = toDoc(current);
  for (const o of ops) {
    if (o.path === null) {
      if (o.op === "remove") throw new ScimError(400, "remove needs a path.", "noTarget");
      if (!isObj(o.value)) throw new ScimError(400, "A path-less operation needs an object value.", "invalidValue");
      for (const [k, v] of Object.entries(o.value)) {
        if (foreignSchema(k)) continue;
        // Entra writes { "name.givenName": "Ada" }; Okta writes { "name": { … } }.
        const path = attrPath(k);
        if (path.length === 2) setUserAttr(d, path[0], { [path[1]]: v }, o.op);
        else if (path.length === 1) setUserAttr(d, path[0], v, o.op);
      }
      continue;
    }
    if (foreignSchema(o.path)) continue;
    const p = parsePath(o.path);
    const [attr, sub1] = p.attr;
    if (attr === "emails" && (p.filter || p.sub || sub1)) {
      // emails[type eq "work"].value — the address of that kind, created if absent.
      const sub = p.sub ?? sub1 ?? "value";
      const hit = d.emails.filter((e) => !p.filter || matches(e, p.filter));
      if (o.op === "remove") {
        d.emails = d.emails.filter((e) => !hit.includes(e));
      } else if (hit.length) {
        for (const e of hit) {
          if (sub === "value") e.value = text(o.value, LIMIT.email, "emails.value") ?? e.value;
          else if (sub === "type") e.type = text(o.value, 40, "emails.type");
          else if (sub === "primary") e.primary = bool(o.value, "emails.primary");
        }
      } else if (sub === "value") {
        const value = text(o.value, LIMIT.email, "emails.value");
        const type = p.filter?.kind === "cmp" && p.filter.path[0] === "type" && typeof p.filter.value === "string" ? p.filter.value : "work";
        if (value) d.emails.push({ value, type, primary: d.emails.length === 0 });
      }
      continue;
    }
    if (p.filter) continue; // a filtered path into something not kept
    if (o.op === "remove") {
      if (attr === "username") throw new ScimError(400, "userName cannot be removed.", "mutability");
      if (attr === "active") d.active = false;
      else if (attr === "name" && sub1) setUserAttr(d, "name", { [sub1]: null }, "replace");
      else setUserAttr(d, attr, attr === "emails" ? [] : null, "replace");
      continue;
    }
    if (sub1) setUserAttr(d, attr, { [sub1]: o.value }, o.op);
    else setUserAttr(d, attr, o.value, o.op);
  }
  return fromDoc(d);
}

/** A User from a POST or PUT body. */
export function entryFromScim(body: unknown): EntryInput {
  if (!isObj(body)) throw new ScimError(400, "The body must be a JSON object.", "invalidSyntax");
  const d: UserDoc = { userName: null, externalId: null, name: { givenName: null, familyName: null }, displayName: null, title: null, emails: [], active: true };
  for (const [k, v] of Object.entries(body)) {
    const key = k.toLowerCase();
    if (key === "schemas" || key === "id" || key === "meta" || key === "groups" || key === "password") continue;
    setUserAttr(d, key, v, "replace");
  }
  return fromDoc(d);
}

/* ── Groups ───────────────────────────────────────────────────────── */

type MemberLike = Pick<DirectoryEntry, "id" | "userName" | "displayName"> & Partial<Pick<DirectoryEntry, "givenName" | "familyName">>;

/** How a member is shown in a group: their display name, else their name, else their userName. */
const memberDisplay = (m: MemberLike) => m.displayName || [m.givenName, m.familyName].filter(Boolean).join(" ") || m.userName;

export function groupResource(g: DirectoryGroup, members: MemberLike[], base: string, withMembers = true): Obj {
  return pruned({
    schemas: [SCHEMA.group],
    id: g.id,
    externalId: g.externalId,
    displayName: g.displayName,
    members: withMembers ? members.map((m) => ({ value: m.id, display: memberDisplay(m), $ref: `${base}/Users/${m.id}`, type: "User" })) : null,
    meta: {
      resourceType: "Group",
      created: g.createdAt,
      lastModified: g.updatedAt,
      location: `${base}/Groups/${g.id}`,
      version: `W/"${Date.parse(g.updatedAt) || 0}"`,
    },
  });
}

function memberIds(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  const ids = arr.map((x) => (isObj(x) ? lookup(x, "value") : x)).filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  if (ids.length > LIMIT.groupMembers) throw new ScimError(400, "Too many members.", "tooMany");
  return ids;
}

export function groupFromScim(body: unknown): GroupInput {
  if (!isObj(body)) throw new ScimError(400, "The body must be a JSON object.", "invalidSyntax");
  const displayName = text(lookup(body, "displayname"), LIMIT.groupName, "displayName");
  if (!displayName) throw new ScimError(400, "displayName is required.", "invalidValue");
  return {
    displayName,
    externalId: text(lookup(body, "externalid"), LIMIT.externalId, "externalId"),
    members: [...new Set(memberIds(lookup(body, "members")))],
  };
}

export function applyGroupPatch(current: GroupInput, ops: PatchOp[]): GroupInput {
  const g: GroupInput = { ...current, members: [...current.members] };
  const set = (key: string, v: unknown, op: PatchOp["op"]) => {
    if (key === "displayname") {
      const name = text(v, LIMIT.groupName, "displayName");
      if (!name) throw new ScimError(400, "displayName cannot be empty.", "invalidValue");
      g.displayName = name;
    } else if (key === "externalid") g.externalId = text(v, LIMIT.externalId, "externalId");
    else if (key === "members") {
      const ids = memberIds(v);
      g.members = op === "replace" ? [...new Set(ids)] : [...new Set([...g.members, ...ids])];
    }
  };
  for (const o of ops) {
    if (o.path === null) {
      if (o.op === "remove") throw new ScimError(400, "remove needs a path.", "noTarget");
      if (!isObj(o.value)) throw new ScimError(400, "A path-less operation needs an object value.", "invalidValue");
      for (const [k, v] of Object.entries(o.value)) {
        const key = attrPath(k)[0];
        if (key && key !== "id") set(key, v, o.op);
      }
      continue;
    }
    const p = parsePath(o.path);
    const key = p.attr[0];
    if (key === "members" && o.op === "remove") {
      if (p.filter) {
        const f = p.filter;
        g.members = g.members.filter((id) => !matches({ value: id }, f));
      } else if (o.value === undefined || o.value === null) {
        g.members = [];
      } else {
        const drop = new Set(memberIds(o.value));
        g.members = g.members.filter((id) => !drop.has(id));
      }
      continue;
    }
    if (p.filter) throw new ScimError(400, `Unsupported path "${o.path}".`, "invalidPath");
    if (o.op === "remove") {
      if (key === "displayname") throw new ScimError(400, "displayName cannot be removed.", "mutability");
      if (key === "externalid") g.externalId = null;
      continue;
    }
    set(key, o.value, o.op);
  }
  return g;
}

/* ── Discovery (RFC 7644 §4) ──────────────────────────────────────── */

export function serviceProviderConfig(base: string) {
  return {
    schemas: [SCHEMA.spc],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_PAGE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "A provisioning token created by the team's owner in LifeOS, sent as Authorization: Bearer <token>.",
        specUri: "https://www.rfc-editor.org/info/rfc6750",
        primary: true,
      },
    ],
    meta: { resourceType: "ServiceProviderConfig", location: `${base}/ServiceProviderConfig` },
  };
}

export function resourceTypes(base: string) {
  return [
    {
      schemas: [SCHEMA.resourceType],
      id: "User",
      name: "User",
      endpoint: "/Users",
      description: "A person provisioned into the team.",
      schema: SCHEMA.user,
      meta: { resourceType: "ResourceType", location: `${base}/ResourceTypes/User` },
    },
    {
      schemas: [SCHEMA.resourceType],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      description: "A group of provisioned people; its owner in LifeOS decides what it grants.",
      schema: SCHEMA.group,
      meta: { resourceType: "ResourceType", location: `${base}/ResourceTypes/Group` },
    },
  ];
}

const attr = (name: string, type: string, extra: Record<string, Json> = {}): Record<string, Json> => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: "readWrite",
  returned: "default",
  uniqueness: "none",
  ...extra,
});

export function schemas(base: string) {
  return [
    {
      schemas: [SCHEMA.schema],
      id: SCHEMA.user,
      name: "User",
      description: "User Account",
      attributes: [
        attr("userName", "string", { required: true, uniqueness: "server" }),
        attr("name", "complex", { subAttributes: [attr("givenName", "string"), attr("familyName", "string"), attr("formatted", "string", { mutability: "readOnly" })] }),
        attr("displayName", "string"),
        attr("title", "string"),
        attr("active", "boolean"),
        attr("emails", "complex", {
          multiValued: true,
          subAttributes: [attr("value", "string"), attr("type", "string", { canonicalValues: ["work", "home", "other"] }), attr("primary", "boolean")],
        }),
        attr("groups", "complex", {
          multiValued: true,
          mutability: "readOnly",
          subAttributes: [attr("value", "string", { mutability: "readOnly" }), attr("$ref", "reference", { mutability: "readOnly", referenceTypes: ["Group"] }), attr("display", "string", { mutability: "readOnly" })],
        }),
      ],
      meta: { resourceType: "Schema", location: `${base}/Schemas/${SCHEMA.user}` },
    },
    {
      schemas: [SCHEMA.schema],
      id: SCHEMA.group,
      name: "Group",
      description: "Group",
      attributes: [
        attr("displayName", "string", { required: true, uniqueness: "server" }),
        attr("members", "complex", {
          multiValued: true,
          subAttributes: [attr("value", "string", { mutability: "immutable" }), attr("$ref", "reference", { mutability: "immutable", referenceTypes: ["User"] }), attr("display", "string", { mutability: "readOnly" })],
        }),
      ],
      meta: { resourceType: "Schema", location: `${base}/Schemas/${SCHEMA.group}` },
    },
  ];
}
