import type { BrainCategoryId } from "@/lib/data/brain";
import type { Concept } from "@/lib/brain/concepts";
import type { InviteState, Role, TeamKind } from "./rules";

/** Rows as stored (migration 012), camelCased. */

export interface DbTeam {
  id: string;
  name: string;
  kind: TeamKind;
  seats: number;
  createdBy: string;
  createdAt: string;
}

export interface DbMember {
  teamId: string;
  userKey: string;
  role: Role;
  displayName: string;
  title: string | null;
  joinedAt: string;
}

export interface DbInvite {
  id: string;
  teamId: string;
  tokenHash: string;
  role: Role;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
}

export interface DbTeamNote {
  id: string;
  teamId: string;
  userKey: string;
  sourceId: string | null;
  category: BrainCategoryId;
  title: string;
  detail: string | null;
  concepts: Concept[];
  createdAt: string;
  updatedAt: string;
}

export interface DbCheckin {
  id: string;
  teamId: string;
  userKey: string;
  week: string;
  done: string;
  focus: string;
  blocker: string;
  helpWanted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbHelp {
  id: string;
  teamId: string;
  checkinId: string;
  userKey: string;
  createdAt: string;
}

export interface DbKudos {
  id: string;
  teamId: string;
  fromKey: string;
  toKey: string;
  message: string;
  createdAt: string;
}

export interface DbPulse {
  teamId: string;
  userKey: string;
  week: string;
  energy: number;
  load: number;
  updatedAt: string;
}

export type TeamErrorCode = "forbidden" | "not_found" | "invalid" | "too_many" | "seats" | "self" | "noop";

export class TeamError extends Error {
  constructor(readonly code: TeamErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TeamError";
  }
}

export interface NewNote {
  sourceId: string | null;
  category: BrainCategoryId;
  title: string;
  detail: string | null;
  concepts: Concept[];
}

export interface CheckinInput {
  done: string;
  focus: string;
  blocker: string;
  helpWanted: boolean;
}

/**
 * Teams, for the acting person. Every method is "as `userKey`": the Supabase
 * implementation leaves the checks to Postgres (policies, column
 * privileges, definer functions — migration 012), the file one applies
 * `rules.ts`. Both throw `TeamError` for what the person may not do.
 */
export interface TeamStore {
  supportsTeams(): Promise<boolean>;
  teamsOf(userKey: string): Promise<{ team: DbTeam; role: Role; members: number }[]>;
  /** The team and its members — null unless the person is one of them. */
  team(userKey: string, teamId: string): Promise<{ team: DbTeam; members: DbMember[] } | null>;
  createTeam(userKey: string, input: { name: string; kind: TeamKind; displayName: string; seats: number }): Promise<DbTeam>;
  updateTeam(userKey: string, teamId: string, patch: { name?: string; seats?: number }): Promise<void>;
  deleteTeam(userKey: string, teamId: string): Promise<void>;

  createInvite(userKey: string, teamId: string, input: { role: Role; maxUses: number; expiresAt: string; tokenHash: string }): Promise<DbInvite>;
  invites(userKey: string, teamId: string): Promise<DbInvite[]>;
  revokeInvite(userKey: string, teamId: string, inviteId: string): Promise<void>;
  previewInvite(userKey: string, tokenHash: string): Promise<{ state: InviteState; team: { id: string; name: string; kind: TeamKind; members: number } | null }>;
  acceptInvite(userKey: string, tokenHash: string, displayName: string): Promise<{ state: InviteState; teamId: string | null }>;

  setRole(userKey: string, teamId: string, targetKey: string, role: Role): Promise<void>;
  removeMember(userKey: string, teamId: string, targetKey: string): Promise<void>;
  updateMe(userKey: string, teamId: string, patch: { displayName?: string; title?: string | null }): Promise<void>;

  notes(userKey: string, teamId: string): Promise<DbTeamNote[]>;
  addNote(userKey: string, teamId: string, note: NewNote): Promise<DbTeamNote>;
  removeNote(userKey: string, teamId: string, noteId: string): Promise<void>;

  checkins(userKey: string, teamId: string, week: string): Promise<{ checkins: DbCheckin[]; help: DbHelp[] }>;
  saveCheckin(userKey: string, teamId: string, week: string, input: CheckinInput): Promise<DbCheckin>;
  setHelp(userKey: string, teamId: string, checkinId: string, on: boolean): Promise<void>;

  kudos(userKey: string, teamId: string, limit: number): Promise<DbKudos[]>;
  giveKudos(userKey: string, teamId: string, toKey: string, message: string): Promise<DbKudos>;
  removeKudos(userKey: string, teamId: string, kudosId: string): Promise<void>;

  savePulse(userKey: string, teamId: string, week: string, energy: number, load: number): Promise<void>;
  myPulse(userKey: string, teamId: string, week: string): Promise<DbPulse | null>;
  pulse(userKey: string, teamId: string, week: string): Promise<{ responses: number; energy: number | null; load: number | null }>;

  /** Erases the person from every team ("delete all my data"). */
  forget(userKey: string): Promise<void>;
}
