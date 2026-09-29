import type { DbMember, DbPulse, DbTeam } from "@/lib/team/types";
import type { DirectoryEntry, DirectoryGroup, GroupMember } from "./types";

/**
 * Keeping a team in step with its directory — the file store's copy of
 * migration 014's `lifeos_directory_sync`, rule for rule:
 *
 *   an active entry linked to an account is a member (if a seat is free);
 *   an inactive one is not; being in a group the owner mapped to "admin"
 *   makes an admin, and leaving every such group undoes it — only for an
 *   admin the directory made; the owner is never touched.
 */

export type SyncResult = "not_found" | "unlinked" | "owner" | "inactive" | "removed" | "full" | "added" | "updated" | "ok";

export interface DirectoryData {
  teams: DbTeam[];
  members: DbMember[];
  pulse: DbPulse[];
  directory: DirectoryEntry[];
  groups: DirectoryGroup[];
  groupMembers: GroupMember[];
}

/** What the team calls a provisioned person: as the directory names them, else their address's local part. */
export function entryName(e: Pick<DirectoryEntry, "displayName" | "givenName" | "familyName" | "userName">): string {
  const full = [e.givenName, e.familyName].filter((x) => x && x.trim()).join(" ").trim();
  const local = e.userName.split("@")[0] ?? "";
  return (e.displayName?.trim() || full || local || "Member").slice(0, 80);
}

/**
 * `linkedBySso`: how entries get linked where this runs — through a SAML
 * sign-in (true, as in Postgres) or by address (the file store).
 */
export function syncEntry(data: DirectoryData, entryId: string, now: string, linkedBySso = true): SyncResult {
  const e = data.directory.find((x) => x.id === entryId);
  if (!e) return "not_found";
  if (!e.userKey) return "unlinked";
  const team = data.teams.find((t) => t.id === e.teamId);
  if (!team) return "not_found";
  const key = e.userKey;
  const cur = data.members.find((m) => m.teamId === e.teamId && m.userKey === key);
  if (cur?.role === "owner") return "owner";

  if (!e.active) {
    if (!cur) return "inactive";
    data.members = data.members.filter((m) => m !== cur);
    data.pulse = data.pulse.filter((p) => !(p.teamId === e.teamId && p.userKey === key));
    return "removed";
  }

  const adminGroups = new Set(data.groups.filter((g) => g.teamId === e.teamId && g.role === "admin").map((g) => g.id));
  const wantAdmin = data.groupMembers.some((gm) => gm.entryId === e.id && adminGroups.has(gm.groupId));

  if (!cur) {
    if (data.members.filter((m) => m.teamId === e.teamId).length >= team.seats) return "full";
    data.members.push({
      teamId: e.teamId,
      userKey: key,
      role: wantAdmin ? "admin" : "member",
      displayName: entryName(e),
      title: null,
      joinedAt: now,
      viaSso: linkedBySso,
      adminByDirectory: wantAdmin,
    });
    return "added";
  }
  if (wantAdmin && cur.role === "member") {
    cur.role = "admin";
    cur.adminByDirectory = true;
    return "updated";
  }
  if (!wantAdmin && cur.role === "admin" && cur.adminByDirectory) {
    cur.role = "member";
    cur.adminByDirectory = false;
    return "updated";
  }
  return "ok";
}

/** An entry leaving the directory takes its membership with it (014's delete trigger). */
export function entryGone(data: DirectoryData, e: DirectoryEntry): void {
  if (!e.userKey) return;
  const cur = data.members.find((m) => m.teamId === e.teamId && m.userKey === e.userKey);
  if (!cur || cur.role === "owner") return;
  data.members = data.members.filter((m) => m !== cur);
  data.pulse = data.pulse.filter((p) => !(p.teamId === e.teamId && p.userKey === e.userKey));
}

/**
 * The file store's stand-in for signing in through the provider: its
 * accounts are email addresses, so an entry is linked to the member whose
 * address it carries. (In Supabase an entry is linked only by a SAML
 * sign-in — `lifeos_sso_join` — never by a matching address.)
 */
export function linkByAddress(data: DirectoryData, e: DirectoryEntry): void {
  if (e.userKey) return;
  const addresses = [e.userName, e.email].filter(Boolean).map((a) => a!.toLowerCase());
  const hit = data.members.find((m) => m.teamId === e.teamId && addresses.includes(m.userKey.toLowerCase()));
  if (!hit) return;
  // One entry per account in a team.
  if (data.directory.some((x) => x !== e && x.teamId === e.teamId && x.userKey === hit.userKey)) return;
  e.userKey = hit.userKey;
}
