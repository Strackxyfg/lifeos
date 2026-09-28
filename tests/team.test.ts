import { describe, it, expect } from "vitest";
import {
  canInvite,
  canModerate,
  canRemove,
  inviteState,
  isWeekKey,
  pulseSummary,
  roleChange,
  weekKey,
} from "@/lib/team/rules";
import { checkinDraft, encounters, forYou, type AuthoredNote } from "@/lib/team/insights";
import type { NoteLike } from "@/lib/brain/graph";

const owner = { key: "o", role: "owner" as const };
const admin = { key: "a", role: "admin" as const };
const admin2 = { key: "a2", role: "admin" as const };
const member = { key: "m", role: "member" as const };
const member2 = { key: "m2", role: "member" as const };

describe("who may do what in a team", () => {
  it("lets only the owner make admins, and nobody make an owner by invitation", () => {
    expect(canInvite("owner", "admin")).toBe(true);
    expect(canInvite("owner", "member")).toBe(true);
    expect(canInvite("admin", "member")).toBe(true);
    expect(canInvite("admin", "admin")).toBe(false);
    expect(canInvite("member", "member")).toBe(false);
    expect(canInvite("owner", "owner")).toBe(false);
  });

  it("hands ownership over — exactly one owner, the old one becomes an admin", () => {
    expect(roleChange(owner, member, "owner")).toEqual({ ok: true, changes: [{ key: "m", role: "owner" }, { key: "o", role: "admin" }] });
    expect(roleChange(owner, admin, "member")).toEqual({ ok: true, changes: [{ key: "a", role: "member" }] });
  });

  it("lets an admin promote a member, and nothing more", () => {
    expect(roleChange(admin, member, "admin").ok).toBe(true);
    expect(roleChange(admin, admin2, "member")).toEqual({ ok: false, reason: "forbidden" });
    expect(roleChange(admin, owner, "member")).toEqual({ ok: false, reason: "forbidden" });
    expect(roleChange(admin, member, "owner")).toEqual({ ok: false, reason: "forbidden" });
  });

  it("tells a member nothing — not even whether a change would be a no-op", () => {
    expect(roleChange(member, owner, "owner")).toEqual({ ok: false, reason: "forbidden" });
    expect(roleChange(member, member2, "admin")).toEqual({ ok: false, reason: "forbidden" });
    expect(roleChange(member, member, "owner")).toEqual({ ok: false, reason: "self" });
  });

  it("lets anyone but the owner leave, the owner remove anyone, an admin remove members", () => {
    expect(canRemove(member, member)).toBe(true);
    expect(canRemove(admin, admin)).toBe(true);
    expect(canRemove(owner, owner)).toBe(false);
    expect(canRemove(owner, admin)).toBe(true);
    expect(canRemove(admin, member)).toBe(true);
    expect(canRemove(admin, admin2)).toBe(false);
    expect(canRemove(admin, owner)).toBe(false);
    expect(canRemove(member, member2)).toBe(false);
  });

  it("lets the author or a moderator remove something shared", () => {
    expect(canModerate(member, "m")).toBe(true);
    expect(canModerate(member, "m2")).toBe(false);
    expect(canModerate(admin, "m2")).toBe(true);
  });
});

describe("invitations", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const live = { expiresAt: "2026-10-05T12:00:00Z", maxUses: 5, uses: 1, revokedAt: null };
  it("says why a link cannot be used", () => {
    expect(inviteState(live, 3, 10, false, now)).toBe("ok");
    expect(inviteState(null, 3, 10, false, now)).toBe("invalid");
    expect(inviteState({ ...live, revokedAt: "2026-09-27T00:00:00Z" }, 3, 10, false, now)).toBe("invalid");
    expect(inviteState(live, 3, 10, true, now)).toBe("member");
    expect(inviteState({ ...live, expiresAt: "2026-09-28T11:59:00Z" }, 3, 10, false, now)).toBe("expired");
    expect(inviteState({ ...live, uses: 5 }, 3, 10, false, now)).toBe("used_up");
    expect(inviteState(live, 10, 10, false, now)).toBe("full");
  });
});

describe("the team's weather", () => {
  it("gives no average below five answers, so no single answer can be read back", () => {
    const four = [1, 2, 3, 4].map((e) => ({ energy: e, load: 3 }));
    expect(pulseSummary(four)).toEqual({ responses: 4, energy: null, load: null });
    expect(pulseSummary([...four, { energy: 5, load: 1 }])).toEqual({ responses: 5, energy: 3, load: 2.6 });
  });
});

describe("weeks", () => {
  it("numbers ISO weeks on the zone's calendar, across a year's end", () => {
    expect(weekKey(new Date("2026-09-28T12:00:00Z"), "UTC")).toBe("2026-W40");
    // 1 January 2027 is a Friday: still week 53 of 2026.
    expect(weekKey(new Date("2027-01-01T12:00:00Z"), "UTC")).toBe("2026-W53");
    expect(weekKey(new Date("2027-01-04T12:00:00Z"), "UTC")).toBe("2027-W01");
    // Sunday 23:30 in Paris is already Monday in Tokyo.
    const t = new Date("2026-10-04T21:30:00Z");
    expect(weekKey(t, "Europe/Paris")).toBe("2026-W40");
    expect(weekKey(t, "Asia/Tokyo")).toBe("2026-W41");
    expect(isWeekKey("2026-W40")).toBe(true);
    expect(isWeekKey("2026-W54")).toBe(false);
  });
});

const note = (id: string, title: string, author = "x", category: NoteLike["category"] = "ideas"): AuthoredNote => ({
  id,
  title,
  category,
  done: false,
  createdAt: "2026-09-20T10:00:00Z",
  author,
});

describe("a collective brain", () => {
  const shared: AuthoredNote[] = [
    note("1", "Réduire le churn des clients pendant l'onboarding", "camille"),
    note("2", "Checklist d'onboarding des nouveaux clients", "marc"),
    note("3", "Refaire le logo", "ines"),
    note("4", "Améliorer l'onboarding des clients avec une vidéo", "camille"),
  ];

  it("finds two people thinking about the same thing — never someone with themselves", () => {
    const found = encounters(shared);
    expect(found.length).toBeGreaterThan(0);
    const authors = new Map(shared.map((n) => [n.id, n.author]));
    for (const e of found) expect(authors.get(e.a)).not.toBe(authors.get(e.b));
    expect(found.some((e) => [e.a, e.b].includes("2"))).toBe(true);
    expect(found.every((e) => e.shared.length > 0)).toBe(true);
  });

  it("says nothing with a single note", () => {
    expect(encounters(shared.slice(0, 1))).toEqual([]);
  });

  it("matches your private notes with what others shared, not with your own shares", () => {
    const mine: NoteLike[] = [{ id: "p1", title: "Préparer l'onboarding des clients de novembre", category: "next", done: false, createdAt: "2026-09-25T10:00:00Z" }];
    const found = forYou(mine, shared, "camille");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.mine === "p1")).toBe(true);
    // Camille's own shared notes (1 and 4) are not suggested to Camille.
    expect(found.some((f) => ["1", "4"].includes(f.theirs))).toBe(false);
    expect(found.map((f) => f.theirs)).toContain("2");
  });

  it("drafts a check-in from the brain, leaving empty what it cannot know", () => {
    const notes: NoteLike[] = [
      { id: "g", title: "Signer 3 clients", category: "goals", done: false, createdAt: "2026-09-01T10:00:00Z" },
      { id: "n", title: "Relancer Acme", category: "next", done: false, createdAt: "2026-09-20T10:00:00Z" },
      { id: "t1", title: "Baisser les prix", category: "ideas", done: false, createdAt: "2026-09-20T10:00:00Z" },
      { id: "t2", title: "Monter en gamme", category: "ideas", done: false, createdAt: "2026-09-20T10:00:00Z" },
    ];
    const draft = checkinDraft({
      notes,
      links: [
        { fromId: "n", toId: "g", kind: "advances", sourceId: "n" },
        { fromId: "t1", toId: "t2", kind: "tension" },
      ],
      now: new Date("2026-09-28T12:00:00Z"),
    });
    expect(draft.done).toBe("");
    expect(draft.focus).toContain("Relancer Acme");
    expect(draft.blocker).toBe("Baisser les prix ↔ Monter en gamme");
  });
});
