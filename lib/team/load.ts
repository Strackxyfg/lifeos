import "server-only";
import { loadBrainView } from "@/lib/brain/load";
import type { Messages } from "@/lib/i18n/dictionaries";
import { canManageTeam, weekKey } from "./rules";
import { checkinDraft, encounters, forYou } from "./insights";
import { getTeamStore, memberId } from "./store";
import type { DbTeamNote } from "./types";
import type { TeamListItem, TeamNoteView, TeamPageView } from "./view";

/**
 * A team's week is counted in UTC, the same for everyone in it: a team spans
 * time zones, and a check-in must land in one week whoever writes it.
 */
export function currentWeek(now = new Date()): string {
  return weekKey(now, "UTC");
}

export async function loadTeams(userKey: string): Promise<{ available: boolean; teams: TeamListItem[] }> {
  const store = getTeamStore();
  if (!(await store.supportsTeams())) return { available: false, teams: [] };
  const rows = await store.teamsOf(userKey);
  return {
    available: true,
    teams: rows
      .map(({ team, role, members }) => ({ id: team.id, name: team.name, kind: team.kind, role, members, seats: team.seats }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Everything the team's page shows, as the viewer may see it — null if they are not in it. */
export async function loadTeamPage(userKey: string, teamId: string, m: Messages, now = new Date()): Promise<TeamPageView | null> {
  const store = getTeamStore();
  const base = await store.team(userKey, teamId);
  if (!base) return null;
  const { team, members } = base;
  const meRow = members.find((x) => x.userKey === userKey);
  if (!meRow) return null;
  const week = currentWeek(now);
  const manage = canManageTeam(meRow.role);

  const [notes, { checkins, help }, kudos, pulseTeam, pulseMine, invites, brain] = await Promise.all([
    store.notes(userKey, teamId),
    store.checkins(userKey, teamId, week),
    store.kudos(userKey, teamId, 30),
    store.pulse(userKey, teamId, week),
    store.myPulse(userKey, teamId, week),
    manage ? store.invites(userKey, teamId) : Promise.resolve([]),
    loadBrainView(m),
  ]);

  const id = (key: string) => memberId(teamId, key);
  const nameOf = new Map(members.map((x) => [x.userKey, x.displayName]));
  const who = (key: string) => nameOf.get(key) ?? "—";

  const noteView = (n: DbTeamNote): TeamNoteView => ({
    id: n.id,
    author: id(n.userKey),
    authorName: who(n.userKey),
    category: n.category,
    title: n.title,
    detail: n.detail,
    createdAt: n.createdAt,
    mine: n.userKey === userKey,
  });
  const byId = new Map(notes.map((n) => [n.id, noteView(n)]));
  const authored = notes.map((n) => ({ id: n.id, title: n.title, detail: n.detail, category: n.category, done: false, createdAt: n.createdAt, concepts: n.concepts, author: n.userKey }));

  const sharedSources = new Set(notes.filter((n) => n.userKey === userKey && n.sourceId).map((n) => n.sourceId));
  const myNotes = brain.notes.filter((n) => !n.done);
  const titles = new Map(brain.notes.map((n) => [n.id, n.title]));
  const mine = checkins.find((c) => c.userKey === userKey) ?? null;

  return {
    team: { id: team.id, name: team.name, kind: team.kind, seats: team.seats, members: members.length },
    me: { id: id(userKey), role: meRow.role, name: meRow.displayName, title: meRow.title },
    members: members.map((x) => ({
      id: id(x.userKey),
      name: x.displayName,
      title: x.title,
      role: x.role,
      joinedAt: x.joinedAt,
      me: x.userKey === userKey,
    })),
    week,
    notes: notes.map(noteView),
    encounters: encounters(authored).map((e) => ({ a: byId.get(e.a)!, b: byId.get(e.b)!, shared: e.shared })),
    forYou: forYou(myNotes, authored, userKey).map((f) => ({
      mine: { id: f.mine, title: titles.get(f.mine) ?? "" },
      theirs: byId.get(f.theirs)!,
      shared: f.shared,
    })),
    checkins: checkins
      .map((c) => {
        const helpers = help.filter((h) => h.checkinId === c.id);
        return {
          id: c.id,
          author: id(c.userKey),
          authorName: who(c.userKey),
          done: c.done,
          focus: c.focus,
          blocker: c.blocker,
          helpWanted: c.helpWanted,
          updatedAt: c.updatedAt,
          mine: c.userKey === userKey,
          helpers: helpers.map((h) => who(h.userKey)),
          iHelp: helpers.some((h) => h.userKey === userKey),
        };
      })
      .sort((a, b) => Number(b.helpWanted) - Number(a.helpWanted) || b.updatedAt.localeCompare(a.updatedAt)),
    mine: mine ? { done: mine.done, focus: mine.focus, blocker: mine.blocker, helpWanted: mine.helpWanted } : null,
    draft: checkinDraft({ notes: brain.notes, links: brain.links, now }),
    kudos: kudos.map((k) => ({
      id: k.id,
      from: id(k.fromKey),
      fromName: who(k.fromKey),
      to: id(k.toKey),
      toName: who(k.toKey),
      message: k.message,
      createdAt: k.createdAt,
      mine: k.fromKey === userKey,
    })),
    pulse: { mine: pulseMine ? { energy: pulseMine.energy, load: pulseMine.load } : null, team: pulseTeam },
    invites: invites.map((i) => ({
      id: i.id,
      role: i.role,
      expiresAt: i.expiresAt,
      maxUses: i.maxUses,
      uses: i.uses,
      revoked: !!i.revokedAt,
      createdByName: who(i.createdBy),
    })),
    shareable: myNotes
      .filter((n) => !sharedSources.has(n.id))
      .slice(0, 400)
      .map((n) => ({ id: n.id, title: n.title, category: n.category })),
  };
}

/**
 * What the island's team building counts: across the person's teams, this
 * week's check-in not yet written (in a team of two or more), and
 * teammates asking for help that nobody has offered yet.
 */
export async function teamWaiting(userKey: string, now = new Date()): Promise<{ name: string; members: number; waiting: number } | null> {
  const store = getTeamStore();
  if (!(await store.supportsTeams())) return null;
  const teams = await store.teamsOf(userKey);
  if (teams.length === 0) return null;
  const week = currentWeek(now);
  let waiting = 0;
  for (const { team, members } of teams) {
    const { checkins, help } = await store.checkins(userKey, team.id, week);
    if (members > 1 && !checkins.some((c) => c.userKey === userKey)) waiting++;
    waiting += checkins.filter((c) => c.userKey !== userKey && c.helpWanted && !help.some((h) => h.checkinId === c.id)).length;
  }
  const first = teams[0];
  return { name: first.team.name, members: first.members, waiting };
}
