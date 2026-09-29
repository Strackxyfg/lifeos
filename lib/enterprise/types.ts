import type { Role } from "@/lib/team/rules";

/** Rows as stored (migration 014), camelCased. */

export interface TeamDomain {
  id: string;
  teamId: string;
  domain: string;
  token: string;
  verifiedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SsoConnection {
  teamId: string;
  providerId: string;
  metadataUrl: string | null;
  jit: boolean;
  enforce: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScimToken {
  id: string;
  teamId: string;
  tokenHash: string;
  label: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface DirectoryEntry {
  id: string;
  teamId: string;
  externalId: string | null;
  userName: string;
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
  title: string | null;
  active: boolean;
  /** The account this entry signed in as, once linked. */
  userKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectoryGroup {
  id: string;
  teamId: string;
  externalId: string | null;
  displayName: string;
  /** What membership grants in the team — the owner's choice, never the provider's. */
  role: "member" | "admin";
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  groupId: string;
  entryId: string;
  teamId: string;
}

/** What SCIM may write about a person. */
export interface EntryInput {
  userName: string;
  externalId: string | null;
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
  title: string | null;
  active: boolean;
}

export interface GroupInput {
  displayName: string;
  externalId: string | null;
  /** Entry ids; ids that are not this team's entries are left out. */
  members: string[];
}

export type EnterpriseErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "not_company"
  | "domain_taken"
  | "too_many"
  | "conflict";

export class EnterpriseError extends Error {
  constructor(readonly code: EnterpriseErrorCode, message?: string) {
    super(message ?? code);
    this.name = "EnterpriseError";
  }
}

export interface EnterpriseOverview {
  role: Role;
  domains: TeamDomain[];
  sso: SsoConnection | null;
  /** The owner's only (tokens are never listed to admins). */
  tokens: Omit<ScimToken, "tokenHash">[];
  directory: { total: number; active: number; linked: number };
  groups: (DirectoryGroup & { members: number })[];
  members: { total: number; viaSso: number };
}

/**
 * The provisioning side: everything SCIM does, for the team a token
 * belongs to. Trusted — the SCIM endpoint calls it only after resolving a
 * token; in Supabase it runs with the service role, scoped by team id in
 * every query, and the database keeps the team in step (014's triggers).
 */
export interface DirectoryStore {
  resolveToken(tokenHash: string): Promise<{ teamId: string; tokenId: string; lastUsedAt: string | null } | null>;
  touchToken(tokenId: string): Promise<void>;
  seats(teamId: string): Promise<number>;

  users(teamId: string, where?: { userName?: string; externalId?: string }): Promise<DirectoryEntry[]>;
  user(teamId: string, id: string): Promise<DirectoryEntry | null>;
  createUser(teamId: string, input: EntryInput): Promise<DirectoryEntry>;
  updateUser(teamId: string, id: string, input: EntryInput): Promise<DirectoryEntry | null>;
  deleteUser(teamId: string, id: string): Promise<boolean>;

  groups(teamId: string, where?: { displayName?: string; externalId?: string }): Promise<DirectoryGroup[]>;
  group(teamId: string, id: string): Promise<DirectoryGroup | null>;
  groupMembers(teamId: string, groupIds?: string[]): Promise<GroupMember[]>;
  createGroup(teamId: string, input: GroupInput): Promise<DirectoryGroup>;
  updateGroup(teamId: string, id: string, input: GroupInput): Promise<DirectoryGroup | null>;
  deleteGroup(teamId: string, id: string): Promise<boolean>;
}

/**
 * The owner's side, as the person (Supabase: their own session, under
 * 014's policies and functions; the file store: the same rules in code),
 * plus the two writes only the server makes after checking something
 * outside (DNS; the identity provider it registered).
 */
export interface EnterpriseStore extends DirectoryStore {
  supportsEnterprise(): Promise<boolean>;
  /** Null unless the person is the team's owner or an admin, in a company. */
  overview(userKey: string, teamId: string): Promise<EnterpriseOverview | null>;
  claimDomain(userKey: string, teamId: string, domain: string, token: string): Promise<TeamDomain>;
  removeDomain(userKey: string, teamId: string, domainId: string): Promise<void>;
  setSsoOptions(userKey: string, teamId: string, patch: { jit?: boolean; enforce?: boolean }): Promise<void>;
  createScimToken(userKey: string, teamId: string, label: string, tokenHash: string): Promise<void>;
  revokeScimToken(userKey: string, teamId: string, tokenId: string): Promise<void>;
  setGroupRole(userKey: string, teamId: string, groupId: string, role: "member" | "admin"): Promise<void>;

  /** Server only, after reading the DNS record. */
  markDomainVerified(teamId: string, domainId: string): Promise<void>;
  /** Server only, after registering the provider with Supabase Auth itself. */
  linkSso(teamId: string, conn: { providerId: string; metadataUrl: string | null; createdBy: string }): Promise<void>;
  /** Server only, after removing the provider from Supabase Auth. */
  unlinkSso(teamId: string): Promise<void>;
}
