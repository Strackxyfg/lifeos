import "server-only";
import { loadBrainView } from "@/lib/brain/load";
import type { Messages } from "@/lib/i18n/dictionaries";
import { canManageTeam, weekKey } from "./rules";
import { checkinDraft, encounters, forYou } from "./insights";
import { getTeamStore, memberId } from "./store";
import type { DbMember, DbTeam, DbTeamNote } from "./types";
import type { EnterpriseView, TeamListItem, TeamNoteView, TeamPageView } from "./view";
import type { Role } from "./rules";
import { isSupabaseConfigured } from "@/lib/db/store";
import { getEnterpriseStore } from "@/lib/enterprise/store";
import { challengeName, challengeValue } from "@/lib/enterprise/domains";
import { serviceProvider } from "@/lib/enterprise/gotrue";
import { appOrigin } from "@/lib/http/origin";

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

  const [notes, { checkins, help }, kudos, pulseTeam, pulseMine, invites, brain, enterprise] = await Promise.all([
    store.notes(userKey, teamId),
    store.checkins(userKey, teamId, week),
    store.kudos(userKey, teamId, 30),
    store.pulse(userKey, teamId, week),
    store.myPulse(userKey, teamId, week),
    manage ? store.invites(userKey, teamId) : Promise.resolve([]),
    loadBrainView(m),
    manage && team.kind === "company" ? loadEnterprise(userKey, team, members, meRow.role) : Promise.resolve(null),
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
    pinned: !!n.pinned,
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
      sso: !!x.viaSso,
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
    enterprise,
  };
}

/**
 * A company's enterprise settings, for its owner and admins. Before
 * migration 014 it says so; a failure to read them never takes the team's
 * page down with it.
 */
async function loadEnterprise(userKey: string, team: DbTeam, members: DbMember[], role: Role): Promise<EnterpriseView | null> {
  const origin = await appOrigin();
  const base = {
    owner: role === "owner",
    ssoAvailable: isSupabaseConfigured(),
    sp: isSupabaseConfigured() ? serviceProvider() : null,
    scimUrl: `${origin}/api/scim/v2`,
    loginUrl: `${origin}/login/sso`,
  };
  const empty: EnterpriseView = {
    ...base,
    available: false,
    domains: [],
    sso: null,
    tokens: [],
    directory: { total: 0, active: 0, linked: 0 },
    groups: [],
    members: { total: members.length, viaSso: 0 },
  };
  const store = getEnterpriseStore();
  try {
    if (!(await store.supportsEnterprise())) return empty;
    const o = await store.overview(userKey, team.id);
    if (!o) return null;
    const nameOf = new Map(members.map((x) => [x.userKey, x.displayName]));
    return {
      ...base,
      available: true,
      owner: o.role === "owner",
      domains: o.domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        verified: !!d.verifiedAt,
        record: { name: challengeName(d.domain), value: challengeValue(d.token) },
      })),
      sso: o.sso ? { providerId: o.sso.providerId, metadataUrl: o.sso.metadataUrl, jit: o.sso.jit, enforce: o.sso.enforce } : null,
      tokens: o.tokens.map((k) => ({
        id: k.id,
        label: k.label,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        revoked: !!k.revokedAt,
        createdByName: nameOf.get(k.createdBy) ?? "\u2014",
      })),
      directory: o.directory,
      groups: o.groups.map((g) => ({ id: g.id, displayName: g.displayName, role: g.role, members: g.members })),
      members: o.members,
    };
  } catch (err) {
    console.error("[team] enterprise settings:", err);
    return empty;
  }
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
