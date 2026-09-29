import { createRlsClient } from "@/lib/supabase/rls";
import { fromRow } from "@/lib/db/supabase-adapter";
import { isMissingTable } from "@/lib/db/errors";
import type { InviteState, Role } from "./rules";
import {
  TeamError,
  type DbCheckin,
  type DbHelp,
  type DbInvite,
  type DbKudos,
  type DbMember,
  type DbPulse,
  type DbTeam,
  type DbTeamNote,
  type TeamErrorCode,
  type TeamStore,
} from "./types";

/**
 * Teams in Supabase. Every call goes through the person's own session (the
 * RLS client): who may see, write or change what is decided by Postgres —
 * migration 012's policies, column privileges and definer functions — not
 * by this file. A write that the database silently filters (0 rows) is
 * reported as "forbidden", never as success.
 */

const T = {
  teams: "lifeos_teams",
  members: "lifeos_team_members",
  invites: "lifeos_team_invites",
  notes: "lifeos_team_notes",
  checkins: "lifeos_team_checkins",
  help: "lifeos_team_help",
  kudos: "lifeos_team_kudos",
  pulse: "lifeos_team_pulse",
} as const;

type Row = Record<string, unknown>;
const rows = <X>(data: Row[] | null) => (data ?? []).map((r) => fromRow<X>(r));

/** An error for a feature whose migration has not been applied yet. */
function migrationPending(n: number): Error {
  const e = new Error(`migration ${n} pending`);
  e.name = "MigrationPending";
  return e;
}

function check(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return;
  if (error.code === "42501" || /permission denied|row-level security/i.test(error.message)) throw new TeamError("forbidden");
  if (/seats_below_members/.test(error.message)) throw new TeamError("seats");
  if (/too_many_teams/.test(error.message)) throw new TeamError("too_many");
  if (error.code === "23505") throw new TeamError("invalid", "duplicate");
  if (error.code === "23514") throw new TeamError("invalid");
  throw new Error(`[teams] ${what}: ${error.message}`);
}

/** The text a definer function answers with, as an error when it is not "ok". */
function verdict(result: unknown): void {
  if (result === "ok") return;
  const code = (["forbidden", "not_found", "invalid", "self", "noop"] as TeamErrorCode[]).find((c) => c === result);
  throw new TeamError(code ?? "invalid");
}

let probe: { value: boolean; until: number } | null = null;

export const supabaseTeamStore: TeamStore = {
  async supportsTeams() {
    if (probe && Date.now() < probe.until) return probe.value;
    const db = await createRlsClient();
    const { error } = await db.from(T.teams).select("id").limit(1);
    const value = !error || !isMissingTable(`${error.code ?? ""} ${error.message}`);
    probe = { value, until: value ? Number.POSITIVE_INFINITY : Date.now() + 60_000 };
    return value;
  },

  async teamsOf(userKey) {
    const db = await createRlsClient();
    const { data: mine, error } = await db.from(T.members).select("team_id, role").eq("user_key", userKey);
    check(error, "memberships");
    const ids = (mine ?? []).map((m) => m.team_id as string);
    if (ids.length === 0) return [];
    const [{ data: teams, error: e1 }, { data: all, error: e2 }] = await Promise.all([
      db.from(T.teams).select("*").in("id", ids),
      db.from(T.members).select("team_id").in("team_id", ids),
    ]);
    check(e1, "teams");
    check(e2, "member counts");
    const count = new Map<string, number>();
    for (const m of all ?? []) count.set(m.team_id as string, (count.get(m.team_id as string) ?? 0) + 1);
    const byId = new Map(rows<DbTeam>(teams).map((t) => [t.id, t]));
    return (mine ?? [])
      .filter((m) => byId.has(m.team_id as string))
      .map((m) => ({ team: byId.get(m.team_id as string)!, role: m.role as Role, members: count.get(m.team_id as string) ?? 1 }));
  },

  async team(_userKey, teamId) {
    const db = await createRlsClient();
    const [{ data: team, error: e1 }, { data: members, error: e2 }] = await Promise.all([
      db.from(T.teams).select("*").eq("id", teamId).maybeSingle(),
      db.from(T.members).select("*").eq("team_id", teamId).order("joined_at", { ascending: true }),
    ]);
    check(e1, "team");
    check(e2, "members");
    if (!team) return null;
    return { team: fromRow<DbTeam>(team), members: rows<DbMember>(members) };
  },

  async createTeam(_userKey, input) {
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_create_team", {
      p_name: input.name,
      p_kind: input.kind,
      p_display: input.displayName,
      p_seats: input.seats,
    });
    check(error, "create team");
    const { data: team, error: e2 } = await db.from(T.teams).select("*").eq("id", data as string).single();
    check(e2, "read new team");
    return fromRow<DbTeam>(team);
  },

  async updateTeam(_userKey, teamId, patch) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.teams).update(patch).eq("id", teamId).select("id");
    check(error, "update team");
    if (!data?.length) throw new TeamError("forbidden");
  },

  async deleteTeam(_userKey, teamId) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.teams).delete().eq("id", teamId).select("id");
    check(error, "delete team");
    if (!data?.length) throw new TeamError("forbidden");
  },

  async createInvite(userKey, teamId, input) {
    const db = await createRlsClient();
    const { data, error } = await db
      .from(T.invites)
      .insert({
        team_id: teamId,
        token_hash: input.tokenHash,
        role: input.role,
        created_by: userKey,
        expires_at: input.expiresAt,
        max_uses: input.maxUses,
      })
      .select("*")
      .single();
    check(error, "create invite");
    return fromRow<DbInvite>(data);
  },

  async invites(_userKey, teamId) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.invites).select("*").eq("team_id", teamId).order("created_at", { ascending: false });
    check(error, "invites");
    return rows<DbInvite>(data);
  },

  async revokeInvite(_userKey, teamId, inviteId) {
    const db = await createRlsClient();
    const { data, error } = await db
      .from(T.invites)
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
      .eq("team_id", teamId)
      .select("id");
    check(error, "revoke invite");
    if (!data?.length) throw new TeamError("forbidden");
  },

  async previewInvite(_userKey, tokenHash) {
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_invite_preview", { p_hash: tokenHash });
    check(error, "preview invite");
    const r = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    const state = (r?.state as InviteState) ?? "invalid";
    if (!r || !r.team_id) return { state, team: null };
    return {
      state,
      team: { id: r.team_id as string, name: r.team_name as string, kind: r.team_kind as DbTeam["kind"], members: Number(r.members) },
    };
  },

  async acceptInvite(_userKey, tokenHash, displayName) {
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_accept_invite", { p_hash: tokenHash, p_display: displayName });
    check(error, "accept invite");
    const r = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    return { state: ((r?.state as InviteState) ?? "invalid"), teamId: (r?.team_id as string) ?? null };
  },

  async setRole(_userKey, teamId, targetKey, role) {
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_set_member_role", { p_team: teamId, p_user: targetKey, p_role: role });
    check(error, "set role");
    verdict(data);
  },

  async removeMember(_userKey, teamId, targetKey) {
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_remove_member", { p_team: teamId, p_user: targetKey });
    check(error, "remove member");
    verdict(data);
  },

  async updateMe(userKey, teamId, patch) {
    const db = await createRlsClient();
    const update: Row = {};
    if (patch.displayName !== undefined) update.display_name = patch.displayName;
    if (patch.title !== undefined) update.title = patch.title;
    const { data, error } = await db.from(T.members).update(update).eq("team_id", teamId).eq("user_key", userKey).select("team_id");
    check(error, "update me");
    if (!data?.length) throw new TeamError("not_found");
  },

  async notes(_userKey, teamId) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.notes).select("*").eq("team_id", teamId).order("created_at", { ascending: false }).limit(500);
    check(error, "notes");
    return rows<DbTeamNote>(data);
  },

  async addNote(userKey, teamId, note) {
    const db = await createRlsClient();
    const { data, error } = await db
      .from(T.notes)
      .insert({
        team_id: teamId,
        user_key: userKey,
        source_id: note.sourceId,
        category: note.category,
        title: note.title,
        detail: note.detail,
        concepts: note.concepts,
      })
      .select("*")
      .single();
    check(error, "share note");
    return fromRow<DbTeamNote>(data);
  },

  async removeNote(_userKey, teamId, noteId) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.notes).delete().eq("id", noteId).eq("team_id", teamId).select("id");
    check(error, "remove note");
    if (!data?.length) throw new TeamError("forbidden");
  },

  async pinNote(_userKey, teamId, noteId, pinned) {
    const db = await createRlsClient();
    // The note must be this team's: the function checks the role in the note's own team.
    const { data: row, error: e0 } = await db.from(T.notes).select("id").eq("id", noteId).eq("team_id", teamId).maybeSingle();
    check(e0, "find note");
    if (!row) throw new TeamError("not_found");
    const { error } = await db.rpc("lifeos_pin_team_note", { p_note: noteId, p_pinned: pinned });
    if (error && /Could not find the function|function .* does not exist/i.test(error.message)) throw migrationPending(13);
    if (error?.code === "P0002") throw new TeamError("not_found");
    check(error, "pin note");
  },

  async checkins(_userKey, teamId, week) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.checkins).select("*").eq("team_id", teamId).eq("week", week);
    check(error, "checkins");
    const checkins = rows<DbCheckin>(data);
    if (checkins.length === 0) return { checkins, help: [] };
    const { data: help, error: e2 } = await db.from(T.help).select("*").in("checkin_id", checkins.map((c) => c.id));
    check(e2, "help");
    return { checkins, help: rows<DbHelp>(help) };
  },

  async saveCheckin(userKey, teamId, week, input) {
    const db = await createRlsClient();
    const values = { done: input.done, focus: input.focus, blocker: input.blocker, help_wanted: input.helpWanted, updated_at: new Date().toISOString() };
    // Update first, insert if there is nothing to update: an upsert would
    // also write the key columns, which the column privileges refuse.
    const { data: updated, error } = await db
      .from(T.checkins)
      .update(values)
      .eq("team_id", teamId)
      .eq("user_key", userKey)
      .eq("week", week)
      .select("*");
    check(error, "update checkin");
    if (updated?.length) return fromRow<DbCheckin>(updated[0]);
    const { data, error: e2 } = await db
      .from(T.checkins)
      .insert({ team_id: teamId, user_key: userKey, week, ...values })
      .select("*")
      .single();
    check(e2, "insert checkin");
    return fromRow<DbCheckin>(data);
  },

  async setHelp(userKey, teamId, checkinId, on) {
    const db = await createRlsClient();
    if (on) {
      const { error } = await db.from(T.help).insert({ team_id: teamId, checkin_id: checkinId, user_key: userKey });
      if (error?.code === "23505") return;
      check(error, "offer help");
    } else {
      const { error } = await db.from(T.help).delete().eq("checkin_id", checkinId).eq("user_key", userKey);
      check(error, "withdraw help");
    }
  },

  async kudos(_userKey, teamId, limit) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.kudos).select("*").eq("team_id", teamId).order("created_at", { ascending: false }).limit(limit);
    check(error, "kudos");
    return rows<DbKudos>(data);
  },

  async giveKudos(userKey, teamId, toKey, message) {
    const db = await createRlsClient();
    const { data, error } = await db
      .from(T.kudos)
      .insert({ team_id: teamId, from_key: userKey, to_key: toKey, message })
      .select("*")
      .single();
    check(error, "give kudos");
    return fromRow<DbKudos>(data);
  },

  async removeKudos(_userKey, teamId, kudosId) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.kudos).delete().eq("id", kudosId).eq("team_id", teamId).select("id");
    check(error, "remove kudos");
    if (!data?.length) throw new TeamError("forbidden");
  },

  async savePulse(userKey, teamId, week, energy, load) {
    const db = await createRlsClient();
    const values = { energy, load, updated_at: new Date().toISOString() };
    const { data: updated, error } = await db
      .from(T.pulse)
      .update(values)
      .eq("team_id", teamId)
      .eq("user_key", userKey)
      .eq("week", week)
      .select("week");
    check(error, "update pulse");
    if (updated?.length) return;
    const { error: e2 } = await db.from(T.pulse).insert({ team_id: teamId, user_key: userKey, week, ...values });
    check(e2, "insert pulse");
  },

  async myPulse(userKey, teamId, week) {
    const db = await createRlsClient();
    const { data, error } = await db.from(T.pulse).select("*").eq("team_id", teamId).eq("user_key", userKey).eq("week", week).maybeSingle();
    check(error, "my pulse");
    return data ? fromRow<DbPulse>(data) : null;
  },

  async pulse(_userKey, teamId, week) {
    const db = await createRlsClient();
    const { data, error } = await db.rpc("lifeos_pulse_summary", { p_team: teamId, p_week: week });
    check(error, "pulse");
    const r = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    return {
      responses: Number(r?.responses ?? 0),
      energy: r?.energy === null || r?.energy === undefined ? null : Number(r.energy),
      load: r?.load === null || r?.load === undefined ? null : Number(r.load),
    };
  },

  async forget() {
    const db = await createRlsClient();
    const { error } = await db.rpc("lifeos_forget_me");
    // No teams table yet (migration 012 pending): nothing to forget.
    if (error && isMissingTable(`${error.code ?? ""} ${error.message}`)) return;
    if (error && /function .* does not exist|Could not find the function/i.test(error.message)) return;
    check(error, "forget");
  },
};
