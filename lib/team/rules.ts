import { wallTime } from "@/lib/reminders/zoned";

/**
 * The rules of a team, in one place.
 *
 * The same rules are enforced twice: here, for the file store and for the
 * page (what buttons to show), and in Postgres (migration 012's functions
 * and policies), where they hold whatever the server code does. The tests
 * check these; the migration's own checks run the same cases against the
 * database.
 *
 * The invariant that matters most is not here, because nothing could break
 * it: a team never reads a member's own brain. It sees what they share.
 */

export type Role = "owner" | "admin" | "member";
export const ROLES: readonly Role[] = ["owner", "admin", "member"];
export type TeamKind = "company" | "circle";
export const TEAM_KINDS: readonly TeamKind[] = ["company", "circle"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export const LIMITS = {
  name: 80,
  displayName: 80,
  title: 80,
  noteTitle: 300,
  noteDetail: 4000,
  checkinField: 1000,
  kudos: 280,
  maxSeats: 10_000,
  inviteMaxUses: 1000,
  inviteMaxDays: 30,
} as const;

/** Below this many answers, the team's pulse is not shown: five people is where one stops being guessable. */
export const PULSE_MIN_RESPONSES = 5;

export interface Actor {
  key: string;
  role: Role;
}

/** Who may create an invitation, and for which role. Only the owner makes admins. */
export function canInvite(actor: Role, inviteRole: Role): boolean {
  if (inviteRole === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && inviteRole === "member";
}

export function canManageTeam(actor: Role): boolean {
  return actor === "owner" || actor === "admin";
}

export type RoleChange = { ok: true; changes: { key: string; role: Role }[] } | { ok: false; reason: "forbidden" | "self" | "noop" };

/**
 * Changing someone's role. The owner can do anything to others, including
 * handing over ownership (there is always exactly one owner: they become an
 * admin). An admin can promote a member to admin; nobody else can change
 * roles, and nobody changes their own.
 */
export function roleChange(actor: Actor, target: Actor, next: Role): RoleChange {
  if (actor.key === target.key) return { ok: false, reason: "self" };
  // Permission first: a member learns nothing about anyone's role from trying.
  if (actor.role === "member") return { ok: false, reason: "forbidden" };
  if (target.role === next) return { ok: false, reason: "noop" };
  if (actor.role === "owner") {
    if (next === "owner") return { ok: true, changes: [{ key: target.key, role: "owner" }, { key: actor.key, role: "admin" }] };
    return { ok: true, changes: [{ key: target.key, role: next }] };
  }
  if (actor.role === "admin" && target.role === "member" && next === "admin") {
    return { ok: true, changes: [{ key: target.key, role: "admin" }] };
  }
  return { ok: false, reason: "forbidden" };
}

/**
 * Removing someone, or leaving. Anyone but the owner may leave (the owner
 * hands the team over first, or deletes it). The owner removes anyone; an
 * admin removes members.
 */
export function canRemove(actor: Actor, target: Actor): boolean {
  if (actor.key === target.key) return actor.role !== "owner";
  if (target.role === "owner") return false;
  if (actor.role === "owner") return true;
  return actor.role === "admin" && target.role === "member";
}

/** Who may delete something shared: its author, or whoever keeps the team tidy. */
export function canModerate(actor: Actor, authorKey: string): boolean {
  return actor.key === authorKey || canManageTeam(actor.role);
}

export interface InviteLike {
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
}

export type InviteState = "ok" | "invalid" | "expired" | "used_up" | "full" | "member";

/** Whether an invitation can be used now, by someone who is (or is not) already in. */
export function inviteState(invite: InviteLike | null, members: number, seats: number, alreadyMember: boolean, now: Date): InviteState {
  if (!invite || invite.revokedAt) return "invalid";
  if (alreadyMember) return "member";
  if (Date.parse(invite.expiresAt) <= now.getTime()) return "expired";
  if (invite.uses >= invite.maxUses) return "used_up";
  if (members >= seats) return "full";
  return "ok";
}

/**
 * The team's weather for a week: averages only once enough people answered
 * that no one answer can be read back out of them. Below that, just how
 * many answered.
 */
export function pulseSummary(answers: { energy: number; load: number }[], k = PULSE_MIN_RESPONSES) {
  const responses = answers.length;
  if (responses < k) return { responses, energy: null, load: null };
  const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
  return { responses, energy: avg(answers.map((a) => a.energy)), load: avg(answers.map((a) => a.load)) };
}

/**
 * The ISO week of an instant on a zone's calendar: "2026-W40". Weeks start
 * on Monday; the first week of a year is the one with its first Thursday.
 */
export function weekKey(date: Date, zone: string): string {
  const w = wallTime(date, zone);
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d));
  const dow = day.getUTCDay() || 7;
  // The Thursday of this week decides its year.
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const year = day.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((day.getTime() - first.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function isWeekKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(v);
}
