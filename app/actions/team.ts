"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore, isSupabaseConfigured } from "@/lib/db/store";
import { getEnterpriseStore } from "@/lib/enterprise/store";
import { deleteSamlProvider } from "@/lib/enterprise/gotrue";
import { getProfile } from "@/lib/user/profile";
import { toBrainNotes } from "@/lib/brain/load";
import { sanitizeConcepts } from "@/lib/brain/concepts";
import { CATEGORY_IDS, kindForCategory } from "@/lib/data/brain";
import { getMessages } from "@/lib/i18n/server";
import { LIMITS, ROLES, TEAM_KINDS, type Role } from "@/lib/team/rules";
import { getTeamStore, inviteHash, memberId } from "@/lib/team/store";
import { currentWeek } from "@/lib/team/load";
import { TeamError, type TeamErrorCode } from "@/lib/team/types";

/**
 * Teams, as actions. Each one: a signed-in person (never the demo identity),
 * input validated here whatever the page sent, members named by their opaque
 * id and resolved to an account only inside the team they belong to, and the
 * store (Postgres, or the file store's rules) having the last word.
 */

export type TeamActionCode = TeamErrorCode | "unauthorized" | "migration_pending" | "failed";
export type TeamResult<T> = { ok: true; data: T } | { ok: false; code: TeamActionCode };

const fail = (code: TeamActionCode): TeamResult<never> => ({ ok: false, code });
const id = z.string().trim().min(1).max(64);

async function actor(): Promise<{ userKey: string } | TeamResult<never>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  if (!(await getTeamStore().supportsTeams())) return fail("migration_pending");
  return { userKey };
}

function failure(err: unknown): TeamResult<never> {
  if (err instanceof TeamError) return fail(err.code);
  if (err instanceof Error && err.name === "MigrationPending") return fail("migration_pending");
  console.error("[team]", err);
  return fail("failed");
}

function refresh(teamId?: string) {
  revalidatePath("/team");
  if (teamId) revalidatePath(`/team/${teamId}`);
  revalidatePath("/hub");
}

/** A member's account, from the opaque id the page knows them by — only among the team's own members. */
async function resolve(userKey: string, teamId: string, member: string): Promise<string> {
  const t = await getTeamStore().team(userKey, teamId);
  if (!t) throw new TeamError("not_found");
  const hit = t.members.find((m) => memberId(teamId, m.userKey) === member);
  if (!hit) throw new TeamError("not_found");
  return hit.userKey;
}

/* ── The team ─────────────────────────────────────────────────────── */

const createSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  kind: z.enum(TEAM_KINDS as unknown as [string, ...string[]]),
  displayName: z.string().trim().min(1).max(LIMITS.displayName),
  seats: z.number().int().min(1).max(LIMITS.maxSeats),
});

export async function createTeam(input: unknown): Promise<TeamResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const team = await getTeamStore().createTeam(a.userKey, { ...parsed.data, kind: parsed.data.kind as "company" | "circle" });
    refresh(team.id);
    return { ok: true, data: { id: team.id } };
  } catch (err) {
    return failure(err);
  }
}

export async function updateTeam(teamId: unknown, input: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const p = z.object({ name: z.string().trim().min(1).max(LIMITS.name).optional(), seats: z.number().int().min(1).max(LIMITS.maxSeats).optional() }).safeParse(input);
  if (!t.success || !p.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().updateTeam(a.userKey, t.data, p.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteTeam(teamId: unknown, confirmName: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  if (!t.success || typeof confirmName !== "string") return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const store = getTeamStore();
    const team = await store.team(a.userKey, t.data);
    if (!team) return fail("not_found");
    // Typed back, like deleting all one's data: it cannot be undone.
    if (confirmName.trim() !== team.team.name) return fail("invalid");
    // An identity provider registered for this team goes with it: Supabase
    // Auth would otherwise keep sending its people to a team that is gone.
    if (isSupabaseConfigured()) {
      const o = await getEnterpriseStore().overview(a.userKey, t.data).catch(() => null);
      if (o?.role === "owner" && o.sso) {
        const gone = await deleteSamlProvider(o.sso.providerId);
        if (!gone.ok) console.error("[team] the SAML provider was not removed:", gone.message);
      }
    }
    await store.deleteTeam(a.userKey, t.data);
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── Invitations ──────────────────────────────────────────────────── */

export async function createInvite(teamId: unknown, input: unknown): Promise<TeamResult<{ token: string; id: string }>> {
  const t = id.safeParse(teamId);
  const p = z
    .object({
      role: z.enum(["admin", "member"]),
      maxUses: z.number().int().min(1).max(LIMITS.inviteMaxUses),
      days: z.number().int().min(1).max(LIMITS.inviteMaxDays),
    })
    .safeParse(input);
  if (!t.success || !p.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    // 192 bits of randomness; only its hash is stored. The link is shown once.
    const token = randomBytes(24).toString("base64url");
    const invite = await getTeamStore().createInvite(a.userKey, t.data, {
      role: p.data.role,
      maxUses: p.data.maxUses,
      expiresAt: new Date(Date.now() + p.data.days * 86_400_000).toISOString(),
      tokenHash: inviteHash(token),
    });
    refresh(t.data);
    return { ok: true, data: { token, id: invite.id } };
  } catch (err) {
    return failure(err);
  }
}

export async function revokeInvite(teamId: unknown, inviteId: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const i = id.safeParse(inviteId);
  if (!t.success || !i.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().revokeInvite(a.userKey, t.data, i.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

const tokenSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{16,128}$/);

export async function acceptInvite(token: unknown, displayName: unknown): Promise<TeamResult<{ teamId: string }>> {
  const tk = tokenSchema.safeParse(token);
  const dn = z.string().trim().min(1).max(LIMITS.displayName).safeParse(displayName);
  if (!tk.success || !dn.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const r = await getTeamStore().acceptInvite(a.userKey, inviteHash(tk.data), dn.data);
    if ((r.state === "ok" || r.state === "member") && r.teamId) {
      refresh(r.teamId);
      return { ok: true, data: { teamId: r.teamId } };
    }
    return fail(r.state === "full" ? "seats" : "invalid");
  } catch (err) {
    return failure(err);
  }
}

/* ── Members ──────────────────────────────────────────────────────── */

export async function setMemberRole(teamId: unknown, member: unknown, role: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const mb = id.safeParse(member);
  const r = z.enum(ROLES as unknown as [Role, ...Role[]]).safeParse(role);
  if (!t.success || !mb.success || !r.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const target = await resolve(a.userKey, t.data, mb.data);
    await getTeamStore().setRole(a.userKey, t.data, target, r.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function removeMember(teamId: unknown, member: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const mb = id.safeParse(member);
  if (!t.success || !mb.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const target = await resolve(a.userKey, t.data, mb.data);
    await getTeamStore().removeMember(a.userKey, t.data, target);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function leaveTeam(teamId: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  if (!t.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().removeMember(a.userKey, t.data, a.userKey);
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function updateMyself(teamId: unknown, input: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const p = z
    .object({ displayName: z.string().trim().min(1).max(LIMITS.displayName), title: z.string().trim().max(LIMITS.title).nullable() })
    .safeParse(input);
  if (!t.success || !p.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().updateMe(a.userKey, t.data, { displayName: p.data.displayName, title: p.data.title || null });
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── The collective brain ─────────────────────────────────────────── */

/**
 * Shares one of the person's own notes. The page sends only its id: the
 * text is read here, from their brain, so nothing can be shared in their
 * name that they did not write.
 */
export async function shareNote(teamId: unknown, noteId: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const n = id.safeParse(noteId);
  if (!t.success || !n.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const item = await getStore().get(a.userKey, "brain", n.data);
    if (!item) return fail("not_found");
    const [note] = toBrainNotes([item], await getMessages());
    await getTeamStore().addNote(a.userKey, t.data, {
      sourceId: note.id,
      category: note.category,
      title: note.title.slice(0, LIMITS.noteTitle),
      detail: note.detail ? note.detail.slice(0, LIMITS.noteDetail) : null,
      concepts: sanitizeConcepts(note.concepts),
    });
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/**
 * Shares several notes at once — the first hire's reading, chosen in one
 * go. Each is read from the person's own brain, as `shareNote` does; one
 * already shared is skipped, not an error.
 */
export async function shareNotes(teamId: unknown, noteIds: unknown): Promise<TeamResult<{ shared: number; skipped: number }>> {
  const t = id.safeParse(teamId);
  const ns = z.array(id).min(1).max(100).safeParse(noteIds);
  if (!t.success || !ns.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const messages = await getMessages();
    let shared = 0;
    let skipped = 0;
    for (const noteId of new Set(ns.data)) {
      const item = await getStore().get(a.userKey, "brain", noteId);
      if (!item) {
        skipped++;
        continue;
      }
      const [note] = toBrainNotes([item], messages);
      try {
        await getTeamStore().addNote(a.userKey, t.data, {
          sourceId: note.id,
          category: note.category,
          title: note.title.slice(0, LIMITS.noteTitle),
          detail: note.detail ? note.detail.slice(0, LIMITS.noteDetail) : null,
          concepts: sanitizeConcepts(note.concepts),
        });
        shared++;
      } catch (err) {
        if (err instanceof TeamError && err.code === "invalid") skipped++;
        else throw err;
      }
    }
    refresh(t.data);
    return { ok: true, data: { shared, skipped } };
  } catch (err) {
    return failure(err);
  }
}

/** Pins a shared note to the team's welcome pack, or unpins it. Owners and admins. */
export async function pinTeamNote(teamId: unknown, noteId: unknown, pinned: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const n = id.safeParse(noteId);
  const p = z.boolean().safeParse(pinned);
  if (!t.success || !n.success || !p.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().pinNote(a.userKey, t.data, n.data, p.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function postTeamNote(teamId: unknown, input: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const p = z
    .object({
      title: z.string().trim().min(1).max(LIMITS.noteTitle),
      detail: z.string().trim().max(LIMITS.noteDetail).nullable(),
      category: z.enum(CATEGORY_IDS as unknown as [string, ...string[]]),
    })
    .safeParse(input);
  if (!t.success || !p.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().addNote(a.userKey, t.data, {
      sourceId: null,
      category: p.data.category as (typeof CATEGORY_IDS)[number],
      title: p.data.title,
      detail: p.data.detail || null,
      concepts: [],
    });
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function removeTeamNote(teamId: unknown, noteId: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const n = id.safeParse(noteId);
  if (!t.success || !n.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().removeNote(a.userKey, t.data, n.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/** A teammate's shared note, copied into the person's own brain — theirs to keep and connect. */
export async function keepTeamNote(teamId: unknown, noteId: unknown): Promise<TeamResult<{ id: string }>> {
  const t = id.safeParse(teamId);
  const n = id.safeParse(noteId);
  if (!t.success || !n.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const store = getTeamStore();
    const [notes, team] = await Promise.all([store.notes(a.userKey, t.data), store.team(a.userKey, t.data)]);
    const note = notes.find((x) => x.id === n.data);
    if (!note || !team) return fail("not_found");
    const author = team.members.find((x) => x.userKey === note.userKey)?.displayName ?? "";
    const m = await getMessages();
    const origin = m.team.keptFrom.replace("{name}", author).replace("{team}", team.team.name);
    const created = await getStore().insert(a.userKey, "brain", {
      category: note.category,
      kind: kindForCategory[note.category],
      seedKey: null,
      title: note.title,
      detail: [note.detail, origin].filter(Boolean).join("\n\n"),
      done: false,
      ai: false,
    });
    revalidatePath("/brain");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return failure(err);
  }
}

/* ── The weekly check-in ──────────────────────────────────────────── */

export async function saveCheckin(teamId: unknown, input: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const field = z.string().trim().max(LIMITS.checkinField);
  const p = z.object({ done: field, focus: field, blocker: field, helpWanted: z.boolean() }).safeParse(input);
  if (!t.success || !p.success) return fail("invalid");
  if (!p.data.done && !p.data.focus && !p.data.blocker) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().saveCheckin(a.userKey, t.data, currentWeek(), {
      ...p.data,
      // Asking for help needs something to help with.
      helpWanted: p.data.helpWanted && p.data.blocker.length > 0,
    });
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function setHelp(teamId: unknown, checkinId: unknown, on: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const c = id.safeParse(checkinId);
  if (!t.success || !c.success || typeof on !== "boolean") return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().setHelp(a.userKey, t.data, c.data, on);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── Kudos ────────────────────────────────────────────────────────── */

export async function giveKudos(teamId: unknown, member: unknown, message: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const mb = id.safeParse(member);
  const msg = z.string().trim().min(1).max(LIMITS.kudos).safeParse(message);
  if (!t.success || !mb.success || !msg.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    const to = await resolve(a.userKey, t.data, mb.data);
    await getTeamStore().giveKudos(a.userKey, t.data, to, msg.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function removeKudos(teamId: unknown, kudosId: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const k = id.safeParse(kudosId);
  if (!t.success || !k.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().removeKudos(a.userKey, t.data, k.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── The pulse ────────────────────────────────────────────────────── */

export async function savePulse(teamId: unknown, energy: unknown, load: unknown): Promise<TeamResult<null>> {
  const t = id.safeParse(teamId);
  const scale = z.number().int().min(1).max(5);
  const e = scale.safeParse(energy);
  const l = scale.safeParse(load);
  if (!t.success || !e.success || !l.success) return fail("invalid");
  const a = await actor();
  if ("ok" in a) return a;
  try {
    await getTeamStore().savePulse(a.userKey, t.data, currentWeek(), e.data, l.data);
    refresh(t.data);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/** The name the person goes by, to suggest when they create or join a team. */
export async function suggestedName(): Promise<string> {
  const p = await getProfile();
  return p.name === "there" ? "" : p.name;
}
