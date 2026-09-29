import { describe, it, expect } from "vitest";
import {
  ScimError,
  applyGroupPatch,
  applyUserPatch,
  entryFromScim,
  groupFromScim,
  listResponse,
  matches,
  paging,
  parseFilter,
  patchOps,
  project,
  simpleEq,
  userResource,
} from "@/lib/enterprise/scim";
import type { DirectoryEntry, EntryInput } from "@/lib/enterprise/types";

const BASE = "https://app.example/api/scim/v2";
const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  teamId: "t",
  externalId: "ext-1",
  userName: "ada@acme.com",
  email: "ada@acme.com",
  givenName: "Ada",
  familyName: "Lovelace",
  displayName: "Ada Lovelace",
  title: null,
  active: true,
  userKey: null,
  createdAt: "2026-09-29T08:00:00.000Z",
  updatedAt: "2026-09-29T09:00:00.000Z",
  ...over,
});
const input = (over: Partial<EntryInput> = {}): EntryInput => ({
  userName: "ada@acme.com",
  externalId: "ext-1",
  email: "ada@acme.com",
  givenName: "Ada",
  familyName: "Lovelace",
  displayName: "Ada Lovelace",
  title: null,
  active: true,
  ...over,
});
const scimError = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ScimError);
    return e as ScimError;
  }
  throw new Error("expected a ScimError");
};

describe("filters", () => {
  const ada = userResource(entry(), [{ id: "g1", displayName: "Engineering" }], BASE);

  it("parse what Entra and Okta send", () => {
    expect(parseFilter('userName eq "ada@acme.com"')).toEqual({ kind: "cmp", path: ["username"], op: "eq", value: "ada@acme.com" });
    expect(parseFilter('externalId eq "ext-1" and active eq true')).toMatchObject({ kind: "and" });
    expect(parseFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "x"')).toMatchObject({ path: ["username"] });
  });

  it("match userName without case, externalId exactly", () => {
    expect(matches(ada, parseFilter('userName eq "ADA@acme.com"'))).toBe(true);
    expect(matches(ada, parseFilter('externalId eq "EXT-1"'))).toBe(false);
    expect(matches(ada, parseFilter('externalId eq "ext-1"'))).toBe(true);
  });

  it("walk sub-attributes, value paths, not, or and presence", () => {
    expect(matches(ada, parseFilter('name.familyName sw "love"'))).toBe(true);
    expect(matches(ada, parseFilter('emails[type eq "work" and value ew "@acme.com"]'))).toBe(true);
    expect(matches(ada, parseFilter('emails eq "ada@acme.com"'))).toBe(true);
    expect(matches(ada, parseFilter('groups[display eq "engineering"]'))).toBe(true);
    expect(matches(ada, parseFilter('not (active eq false) and (title pr or displayName co "Lovelace")'))).toBe(true);
    expect(matches(ada, parseFilter("title pr"))).toBe(false);
    expect(matches(ada, parseFilter('title eq "x"'))).toBe(false);
    expect(matches(ada, parseFilter('title ne "x"'))).toBe(true);
  });

  it("keep escaped quotes inside strings", () => {
    const f = parseFilter('displayName eq "Ada \\"the first\\" Lovelace"');
    expect(f).toMatchObject({ value: 'Ada "the first" Lovelace' });
  });

  it("refuse what they cannot read, as invalidFilter", () => {
    for (const bad of ['userName eq', 'userName foo "x"', '(userName eq "x"', 'userName eq "x" extra', 'userName eq "unterminated', "eq \"x\""]) {
      const e = scimError(() => parseFilter(bad));
      expect(e.status, bad).toBe(400);
      expect(e.scimType, bad).toBe("invalidFilter");
    }
  });

  it("say when a store can look the value up directly", () => {
    expect(simpleEq(parseFilter('userName eq "x"'), ["username", "externalid"])).toEqual({ attr: "username", value: "x" });
    expect(simpleEq(parseFilter('userName co "x"'), ["username"])).toBeNull();
    expect(simpleEq(parseFilter('displayName eq "x"'), ["username"])).toBeNull();
  });
});

describe("users on the wire", () => {
  it("are written the way the RFC shows them", () => {
    const r = userResource(entry(), [], BASE);
    expect(r).toEqual({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      externalId: "ext-1",
      userName: "ada@acme.com",
      name: { givenName: "Ada", familyName: "Lovelace", formatted: "Ada Lovelace" },
      displayName: "Ada Lovelace",
      emails: [{ value: "ada@acme.com", type: "work", primary: true }],
      active: true,
      meta: {
        resourceType: "User",
        created: "2026-09-29T08:00:00.000Z",
        lastModified: "2026-09-29T09:00:00.000Z",
        location: `${BASE}/Users/0f8fad5b-d9cb-469f-a165-70867728950e`,
        version: `W/"${Date.parse("2026-09-29T09:00:00.000Z")}"`,
      },
    });
  });

  it("are read from an Entra ID create, the enterprise extension ignored", () => {
    const body = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
      externalId: "8a1d-entra",
      userName: "Grace.Hopper@acme.com",
      active: true,
      displayName: "Grace Hopper",
      emails: [{ primary: true, type: "work", value: "grace.hopper@acme.com" }],
      name: { formatted: "Grace Hopper", familyName: "Hopper", givenName: "Grace" },
      title: "Rear Admiral",
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { department: "Navy" },
      phoneNumbers: [{ type: "work", value: "+1 555" }],
    };
    expect(entryFromScim(body)).toEqual({
      userName: "Grace.Hopper@acme.com",
      externalId: "8a1d-entra",
      email: "grace.hopper@acme.com",
      givenName: "Grace",
      familyName: "Hopper",
      displayName: "Grace Hopper",
      title: "Rear Admiral",
      active: true,
    });
  });

  it("are read from an Okta create (no active: active)", () => {
    const e = entryFromScim({ userName: "katherine@acme.com", name: { givenName: "Katherine", familyName: "Johnson" }, emails: [{ value: "katherine@acme.com", primary: true }] });
    expect(e).toMatchObject({ userName: "katherine@acme.com", active: true, email: "katherine@acme.com", externalId: null, title: null });
  });

  it("need a userName, within bounds", () => {
    expect(scimError(() => entryFromScim({ displayName: "No name" })).scimType).toBe("invalidValue");
    expect(scimError(() => entryFromScim({ userName: "x".repeat(321) })).scimType).toBe("invalidValue");
    expect(scimError(() => entryFromScim({ userName: "x", active: "maybe" })).scimType).toBe("invalidValue");
    expect(scimError(() => entryFromScim([1, 2])).scimType).toBe("invalidSyntax");
  });
});

describe("PATCH on a user", () => {
  const ops = (...o: unknown[]) => patchOps({ schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: o });

  it("deactivates the way Entra ID writes it", () => {
    expect(applyUserPatch(input(), ops({ op: "Replace", path: "active", value: "False" })).active).toBe(false);
  });

  it("deactivates the way Okta writes it", () => {
    expect(applyUserPatch(input(), ops({ op: "replace", value: { active: false } })).active).toBe(false);
  });

  it("sets the work address through a value path, creating it when absent", () => {
    const changed = applyUserPatch(input(), ops({ op: "Replace", path: 'emails[type eq "work"].value', value: "ada.l@acme.com" }));
    expect(changed.email).toBe("ada.l@acme.com");
    const created = applyUserPatch(input({ email: null }), ops({ op: "Add", path: 'emails[type eq "work"].value', value: "new@acme.com" }));
    expect(created.email).toBe("new@acme.com");
    const removed = applyUserPatch(input(), ops({ op: "Remove", path: 'emails[type eq "work"]' }));
    expect(removed.email).toBeNull();
  });

  it("reaches sub-attributes by path, by dotted key and by object", () => {
    expect(applyUserPatch(input(), ops({ op: "Replace", path: "name.givenName", value: "Augusta" })).givenName).toBe("Augusta");
    expect(applyUserPatch(input(), ops({ op: "Replace", value: { "name.familyName": "King", displayName: "Ada King" } }))).toMatchObject({ familyName: "King", displayName: "Ada King", givenName: "Ada" });
    expect(applyUserPatch(input(), ops({ op: "replace", value: { name: { givenName: "A." } } }))).toMatchObject({ givenName: "A.", familyName: "Lovelace" });
    expect(applyUserPatch(input(), ops({ op: "replace", path: "urn:ietf:params:scim:schemas:core:2.0:User:title", value: "Countess" })).title).toBe("Countess");
  });

  it("ignores what LifeOS does not keep, refuses what it cannot do", () => {
    const same = applyUserPatch(input(), ops(
      { op: "Add", path: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", value: "R&D" },
      { op: "Replace", path: 'phoneNumbers[type eq "work"].value', value: "+44" },
      { op: "Add", value: { preferredLanguage: "en" } }
    ));
    expect(same).toEqual(input());
    expect(scimError(() => applyUserPatch(input(), ops({ op: "Remove", path: "userName" }))).scimType).toBe("mutability");
    expect(scimError(() => applyUserPatch(input(), ops({ op: "Replace", path: "userName", value: "" }))).scimType).toBe("invalidValue");
    expect(scimError(() => ops({ op: "Move", path: "x" })).scimType).toBe("invalidSyntax");
    expect(scimError(() => patchOps({ Operations: [] })).scimType).toBe("invalidSyntax");
    expect(applyUserPatch(input({ title: "Countess" }), ops({ op: "remove", path: "title" })).title).toBeNull();
  });
});

describe("groups", () => {
  const u1 = "11111111-1111-4111-8111-111111111111";
  const u2 = "22222222-2222-4222-8222-222222222222";
  const u3 = "33333333-3333-4333-8333-333333333333";
  const g = { displayName: "Engineering", externalId: null, members: [u1, u2] };
  const ops = (...o: unknown[]) => patchOps({ Operations: o });

  it("are read from a create", () => {
    expect(groupFromScim({ displayName: " Admins ", members: [{ value: u1 }, { value: u1 }, { value: u2, display: "x" }] })).toEqual({ displayName: "Admins", externalId: null, members: [u1, u2] });
    expect(scimError(() => groupFromScim({ members: [] })).scimType).toBe("invalidValue");
  });

  it("take members in and out the way Entra ID writes it", () => {
    expect(applyGroupPatch(g, ops({ op: "Add", path: "members", value: [{ value: u3 }] })).members).toEqual([u1, u2, u3]);
    expect(applyGroupPatch(g, ops({ op: "Remove", path: "members", value: [{ value: u1 }] })).members).toEqual([u2]);
  });

  it("…and the way Okta writes it", () => {
    expect(applyGroupPatch(g, ops({ op: "remove", path: `members[value eq "${u2}"]` })).members).toEqual([u1]);
    expect(applyGroupPatch(g, ops({ op: "replace", path: "members", value: [{ value: u3 }] })).members).toEqual([u3]);
    expect(applyGroupPatch(g, ops({ op: "replace", value: { id: "ignored", displayName: "Eng" } })).displayName).toBe("Eng");
    expect(applyGroupPatch(g, ops({ op: "remove", path: "members" })).members).toEqual([]);
  });

  it("keep a name", () => {
    expect(scimError(() => applyGroupPatch(g, ops({ op: "remove", path: "displayName" }))).scimType).toBe("mutability");
    expect(scimError(() => applyGroupPatch(g, ops({ op: "replace", path: "displayName", value: " " }))).scimType).toBe("invalidValue");
  });
});

describe("lists", () => {
  it("page from 1, never past 200", () => {
    expect(paging(new URLSearchParams())).toEqual({ start: 1, count: 100 });
    expect(paging(new URLSearchParams("startIndex=0&count=-5"))).toEqual({ start: 1, count: 0 });
    expect(paging(new URLSearchParams("startIndex=21&count=5000"))).toEqual({ start: 21, count: 200 });
    expect(paging(new URLSearchParams("startIndex=abc"))).toEqual({ start: 1, count: 100 });
    expect(listResponse([{ id: "a" }], 7, 3)).toEqual({ schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: 7, startIndex: 3, itemsPerPage: 1, Resources: [{ id: "a" }] });
  });

  it("leave out what is excluded, keep id, schemas and meta", () => {
    const r = { schemas: ["x"], id: "1", displayName: "G", members: [{ value: "u" }], meta: {} };
    expect(project(r, new URLSearchParams("excludedAttributes=members"))).toEqual({ schemas: ["x"], id: "1", displayName: "G", meta: {} });
    expect(project(r, new URLSearchParams("attributes=displayName"))).toEqual({ schemas: ["x"], id: "1", displayName: "G", meta: {} });
  });
});
