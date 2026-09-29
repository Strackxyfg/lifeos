import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  canInvite,
  canManageTeam,
  canModerate,
  canRemove,
  inviteState,
  pulseSummary,
  roleChange,
  type Role,
} from "./rules";
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
  type TeamStore,
} from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "teams.json");

interface Shape {
  teams: DbTeam[];
  members: DbMember[];
  invites: DbInvite[];
  notes: DbTeamNote[];
  checkins: DbCheckin[];
  help: DbHelp[];
  kudos: DbKudos[];
  pulse: DbPulse[];
}

const EMPTY: Shape = { teams: [], members: [], invites: [], notes: [], checkins: [], help: [], kudos: [], pulse: [] };

/**
 * The same queue as the brain's file store (`local-adapter.ts`): one chain
 * for every file write in the process, whichever bundle the code runs in.
 */
const QUEUE = Symbol.for("lifeos.localStore.queue");
type Global = typeof globalThis & { [QUEUE]?: Promise<unknown> };

async function readFile(): Promise<Shape> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
    throw err;
  }
  try {
    const data = JSON.parse(raw) as Partial<Shape>;
    return { ...structuredClone(EMPTY), ...data };
  } catch {
    // Fail closed: a file that cannot be read is never taken for an empty one.
    throw new Error(`[teams] ${FILE} cannot be read; nothing was written.`);
  }
}

async function writeFile(data: Shape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(temp, FILE);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

function run<T>(fn: (data: Shape) => T | Promise<T>, write: boolean): Promise<T> {
  const g = globalThis as Global;
  const next = (g[QUEUE] ?? Promise.resolve()).then(async () => {
    const data = await readFile();
    const out = await fn(data);
    if (write) await writeFile(data);
    return out;
  });
  g[QUEUE] = next.catch(() => undefined);
  return next;
}

const read = <T>(fn: (data: Shape) => T) => run(fn, false);
const mutate = <T>(fn: (data: Shape) => T) => run(fn, true);

const now = () => new Date().toISOString();

function memberOf(data: Shape, teamId: string, userKey: string): DbMember | undefined {
  return data.members.find((m) => m.teamId === teamId && m.userKey === userKey);
}

function need(data: Shape, teamId: string, userKey: string): DbMember {
  const me = memberOf(data, teamId, userKey);
  if (!me) throw new TeamError("not_found");
  return me;
}

/** Everything that hangs off a team, when the team goes. */
function dropTeam(data: Shape, teamId: string) {
  for (const k of ["members", "invites", "notes", "checkins", "help", "kudos", "pulse"] as const) {
    (data[k] as { teamId: string }[]) = (data[k] as { teamId: string }[]).filter((r) => r.teamId !== teamId);
  }
  data.teams = data.teams.filter((t) => t.id !== teamId);
}

/**
 * Teams in a local file, for running LifeOS without a database. The rules
 * are `rules.ts`, the same ones migration 012 enforces in Postgres.
 */
export const localTeamStore: TeamStore = {
  async supportsTeams() {
    return true;
  },

  teamsOf(userKey) {
    return read((data) =>
      data.members
        .filter((m) => m.userKey === userKey)
        .map((m) => {
          const team = data.teams.find((t) => t.id === m.teamId)!;
          return { team, role: m.role, members: data.members.filter((x) => x.teamId === m.teamId).length };
        })
        .filter((x) => x.team)
    );
  },

  team(userKey, teamId) {
    return read((data) => {
      if (!memberOf(data, teamId, userKey)) return null;
      const team = data.teams.find((t) => t.id === teamId);
      if (!team) return null;
      return { team, members: data.members.filter((m) => m.teamId === teamId) };
    });
  },

  createTeam(userKey, input) {
    return mutate((data) => {
      if (data.members.filter((m) => m.userKey === userKey).length >= 50) throw new TeamError("too_many");
      const team: DbTeam = {
        id: randomUUID(),
        name: input.name.trim(),
        kind: input.kind,
        seats: input.seats,
        createdBy: userKey,
        createdAt: now(),
      };
      data.teams.push(team);
      data.members.push({ teamId: team.id, userKey, role: "owner", displayName: input.displayName.trim(), title: null, joinedAt: now() });
      return team;
    });
  },

  updateTeam(userKey, teamId, patch) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      if (!canManageTeam(me.role)) throw new TeamError("forbidden");
      const team = data.teams.find((t) => t.id === teamId)!;
      if (patch.seats !== undefined) {
        if (patch.seats < data.members.filter((m) => m.teamId === teamId).length) throw new TeamError("seats");
        team.seats = patch.seats;
      }
      if (patch.name !== undefined) team.name = patch.name.trim();
    });
  },

  deleteTeam(userKey, teamId) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      if (me.role !== "owner") throw new TeamError("forbidden");
      dropTeam(data, teamId);
    });
  },

  createInvite(userKey, teamId, input) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      if (!canInvite(me.role, input.role)) throw new TeamError("forbidden");
      const invite: DbInvite = {
        id: randomUUID(),
        teamId,
        tokenHash: input.tokenHash,
        role: input.role,
        createdBy: userKey,
        createdAt: now(),
        expiresAt: input.expiresAt,
        maxUses: input.maxUses,
        uses: 0,
        revokedAt: null,
      };
      data.invites.push(invite);
      return invite;
    });
  },

  invites(userKey, teamId) {
    return read((data) => {
      const me = memberOf(data, teamId, userKey);
      if (!me || !canManageTeam(me.role)) return [];
      return data.invites.filter((i) => i.teamId === teamId);
    });
  },

  revokeInvite(userKey, teamId, inviteId) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      if (!canManageTeam(me.role)) throw new TeamError("forbidden");
      const invite = data.invites.find((i) => i.id === inviteId && i.teamId === teamId);
      if (!invite) throw new TeamError("not_found");
      invite.revokedAt = invite.revokedAt ?? now();
    });
  },

  previewInvite(userKey, tokenHash) {
    return read((data) => {
      const invite = data.invites.find((i) => i.tokenHash === tokenHash) ?? null;
      const team = invite ? data.teams.find((t) => t.id === invite.teamId) : undefined;
      if (!invite || !team || invite.revokedAt) return { state: "invalid" as const, team: null };
      const members = data.members.filter((m) => m.teamId === team.id).length;
      const state = inviteState(invite, members, team.seats, !!memberOf(data, team.id, userKey), new Date());
      return { state, team: { id: team.id, name: team.name, kind: team.kind, members } };
    });
  },

  acceptInvite(userKey, tokenHash, displayName) {
    return mutate((data) => {
      const invite = data.invites.find((i) => i.tokenHash === tokenHash) ?? null;
      const team = invite ? data.teams.find((t) => t.id === invite.teamId) : undefined;
      if (!invite || !team) return { state: "invalid" as const, teamId: null };
      const members = data.members.filter((m) => m.teamId === team.id).length;
      const already = !!memberOf(data, team.id, userKey);
      const state = inviteState(invite, members, team.seats, already, new Date());
      if (state === "member") return { state, teamId: team.id };
      if (state !== "ok") return { state, teamId: null };
      data.members.push({ teamId: team.id, userKey, role: invite.role, displayName: displayName.trim(), title: null, joinedAt: now() });
      invite.uses += 1;
      return { state, teamId: team.id };
    });
  },

  setRole(userKey, teamId, targetKey, role) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      const target = memberOf(data, teamId, targetKey);
      if (!target) throw new TeamError("not_found");
      const change = roleChange({ key: me.userKey, role: me.role }, { key: target.userKey, role: target.role }, role);
      if (!change.ok) throw new TeamError(change.reason);
      for (const c of change.changes) memberOf(data, teamId, c.key)!.role = c.role;
    });
  },

  removeMember(userKey, teamId, targetKey) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      const target = memberOf(data, teamId, targetKey);
      if (!target) throw new TeamError("not_found");
      if (!canRemove({ key: me.userKey, role: me.role }, { key: target.userKey, role: target.role })) throw new TeamError("forbidden");
      data.members = data.members.filter((m) => !(m.teamId === teamId && m.userKey === targetKey));
      // Their anonymous answers leave with them; what they shared stays shared.
      data.pulse = data.pulse.filter((p) => !(p.teamId === teamId && p.userKey === targetKey));
    });
  },

  updateMe(userKey, teamId, patch) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      if (patch.displayName !== undefined) me.displayName = patch.displayName.trim();
      if (patch.title !== undefined) me.title = patch.title?.trim() || null;
    });
  },

  notes(userKey, teamId) {
    return read((data) => {
      if (!memberOf(data, teamId, userKey)) return [];
      return data.notes.filter((n) => n.teamId === teamId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  },

  addNote(userKey, teamId, note) {
    return mutate((data) => {
      need(data, teamId, userKey);
      if (note.sourceId && data.notes.some((n) => n.teamId === teamId && n.userKey === userKey && n.sourceId === note.sourceId)) {
        throw new TeamError("invalid", "already shared");
      }
      const row: DbTeamNote = { id: randomUUID(), teamId, userKey, ...note, createdAt: now(), updatedAt: now() };
      data.notes.push(row);
      return row;
    });
  },

  removeNote(userKey, teamId, noteId) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      const note = data.notes.find((n) => n.id === noteId && n.teamId === teamId);
      if (!note) throw new TeamError("not_found");
      if (!canModerate({ key: me.userKey, role: me.role }, note.userKey)) throw new TeamError("forbidden");
      data.notes = data.notes.filter((n) => n.id !== noteId);
    });
  },

  pinNote(userKey, teamId, noteId, pinned) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      // Permission first, as the database's function checks it.
      if (!canManageTeam(me.role)) throw new TeamError("forbidden");
      const note = data.notes.find((n) => n.id === noteId && n.teamId === teamId);
      if (!note) throw new TeamError("not_found");
      note.pinned = pinned;
      note.pinnedAt = pinned ? now() : null;
    });
  },

  checkins(userKey, teamId, week) {
    return read((data) => {
      if (!memberOf(data, teamId, userKey)) return { checkins: [], help: [] };
      const checkins = data.checkins.filter((c) => c.teamId === teamId && c.week === week);
      const ids = new Set(checkins.map((c) => c.id));
      return { checkins, help: data.help.filter((h) => ids.has(h.checkinId)) };
    });
  },

  saveCheckin(userKey, teamId, week, input) {
    return mutate((data) => {
      need(data, teamId, userKey);
      const existing = data.checkins.find((c) => c.teamId === teamId && c.userKey === userKey && c.week === week);
      if (existing) {
        Object.assign(existing, input, { updatedAt: now() });
        return existing;
      }
      const row: DbCheckin = { id: randomUUID(), teamId, userKey, week, ...input, createdAt: now(), updatedAt: now() };
      data.checkins.push(row);
      return row;
    });
  },

  setHelp(userKey, teamId, checkinId, on) {
    return mutate((data) => {
      need(data, teamId, userKey);
      const checkin = data.checkins.find((c) => c.id === checkinId && c.teamId === teamId);
      if (!checkin) throw new TeamError("not_found");
      if (checkin.userKey === userKey) throw new TeamError("self");
      const has = data.help.some((h) => h.checkinId === checkinId && h.userKey === userKey);
      if (on && !has) data.help.push({ id: randomUUID(), teamId, checkinId, userKey, createdAt: now() });
      if (!on) data.help = data.help.filter((h) => !(h.checkinId === checkinId && h.userKey === userKey));
    });
  },

  kudos(userKey, teamId, limit) {
    return read((data) => {
      if (!memberOf(data, teamId, userKey)) return [];
      return data.kudos
        .filter((k) => k.teamId === teamId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    });
  },

  giveKudos(userKey, teamId, toKey, message) {
    return mutate((data) => {
      need(data, teamId, userKey);
      if (toKey === userKey) throw new TeamError("self");
      if (!memberOf(data, teamId, toKey)) throw new TeamError("not_found");
      const row: DbKudos = { id: randomUUID(), teamId, fromKey: userKey, toKey, message: message.trim(), createdAt: now() };
      data.kudos.push(row);
      return row;
    });
  },

  removeKudos(userKey, teamId, kudosId) {
    return mutate((data) => {
      const me = need(data, teamId, userKey);
      const k = data.kudos.find((x) => x.id === kudosId && x.teamId === teamId);
      if (!k) throw new TeamError("not_found");
      if (!canModerate({ key: me.userKey, role: me.role }, k.fromKey)) throw new TeamError("forbidden");
      data.kudos = data.kudos.filter((x) => x.id !== kudosId);
    });
  },

  savePulse(userKey, teamId, week, energy, load) {
    return mutate((data) => {
      need(data, teamId, userKey);
      const existing = data.pulse.find((p) => p.teamId === teamId && p.userKey === userKey && p.week === week);
      if (existing) Object.assign(existing, { energy, load, updatedAt: now() });
      else data.pulse.push({ teamId, userKey, week, energy, load, updatedAt: now() });
    });
  },

  myPulse(userKey, teamId, week) {
    return read((data) => data.pulse.find((p) => p.teamId === teamId && p.userKey === userKey && p.week === week) ?? null);
  },

  pulse(userKey, teamId, week) {
    return read((data) => {
      if (!memberOf(data, teamId, userKey)) throw new TeamError("forbidden");
      return pulseSummary(data.pulse.filter((p) => p.teamId === teamId && p.week === week));
    });
  },

  forget(userKey) {
    return mutate((data) => {
      for (const own of data.members.filter((m) => m.userKey === userKey && m.role === "owner")) {
        const heirs = data.members
          .filter((m) => m.teamId === own.teamId && m.userKey !== userKey)
          .sort((a, b) => Number(b.role === "admin") - Number(a.role === "admin") || a.joinedAt.localeCompare(b.joinedAt));
        if (heirs.length === 0) dropTeam(data, own.teamId);
        else heirs[0].role = "owner" as Role;
      }
      data.members = data.members.filter((m) => m.userKey !== userKey);
      data.pulse = data.pulse.filter((p) => p.userKey !== userKey);
      data.help = data.help.filter((h) => h.userKey !== userKey);
      data.kudos = data.kudos.filter((k) => k.fromKey !== userKey && k.toKey !== userKey);
      data.checkins = data.checkins.filter((c) => c.userKey !== userKey);
      data.notes = data.notes.filter((n) => n.userKey !== userKey);
    });
  },
};
