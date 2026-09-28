import type { BrainCategoryId } from "@/lib/data/brain";
import type { Role, TeamKind } from "./rules";

/**
 * What a team's page receives. Members are named by opaque ids
 * (`memberId`), never by account keys; the only private notes in it are the
 * viewer's own (titles, for the share picker and "for you").
 */

export interface MemberView {
  id: string;
  name: string;
  title: string | null;
  role: Role;
  joinedAt: string;
  me: boolean;
}

export interface TeamNoteView {
  id: string;
  author: string;
  authorName: string;
  category: BrainCategoryId;
  title: string;
  detail: string | null;
  createdAt: string;
  mine: boolean;
}

export interface CheckinView {
  id: string;
  author: string;
  authorName: string;
  done: string;
  focus: string;
  blocker: string;
  helpWanted: boolean;
  updatedAt: string;
  mine: boolean;
  helpers: string[];
  iHelp: boolean;
}

export interface KudosView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  message: string;
  createdAt: string;
  mine: boolean;
}

export interface InviteView {
  id: string;
  role: Role;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
  createdByName: string;
}

export interface TeamPageView {
  team: { id: string; name: string; kind: TeamKind; seats: number; members: number };
  me: { id: string; role: Role; name: string; title: string | null };
  members: MemberView[];
  week: string;
  notes: TeamNoteView[];
  encounters: { a: TeamNoteView; b: TeamNoteView; shared: string[] }[];
  forYou: { mine: { id: string; title: string }; theirs: TeamNoteView; shared: string[] }[];
  checkins: CheckinView[];
  mine: { done: string; focus: string; blocker: string; helpWanted: boolean } | null;
  draft: { done: string; focus: string; blocker: string };
  kudos: KudosView[];
  pulse: { mine: { energy: number; load: number } | null; team: { responses: number; energy: number | null; load: number | null } };
  invites: InviteView[];
  /** The viewer's own brain notes not yet shared here — for the share picker. */
  shareable: { id: string; title: string; category: BrainCategoryId }[];
}

export interface TeamListItem {
  id: string;
  name: string;
  kind: TeamKind;
  role: Role;
  members: number;
  seats: number;
}
