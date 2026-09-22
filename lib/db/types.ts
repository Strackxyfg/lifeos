import type { ProjectStatus, DealStage, TxnType } from "@/lib/data/workspace";
import type { BrainCategoryId, BrainItemKind } from "@/lib/data/brain";

/**
 * Persisted entities. `userKey` scopes every row to its owner — it holds the
 * Supabase auth uid once real auth is wired, and the session email until then.
 */
export interface Owned {
  id: string;
  userKey: string;
  createdAt: string;
}

export interface DbProject extends Owned {
  name: string;
  status: ProjectStatus;
  owner: string;
  due: string;
  progress: number;
  priority: "Low" | "Medium" | "High";
}

export interface DbDeal extends Owned {
  name: string;
  company: string;
  stage: DealStage;
  value: number;
  owner: string;
  next: string;
}

export interface DbTransaction extends Owned {
  item: string;
  type: TxnType;
  amount: number;
  category: string;
  date: string;
}

export interface DbTask extends Owned {
  /** i18n key for seeded tasks; null for user-created ones. */
  labelKey: string | null;
  label: string | null;
  done: boolean;
}

export interface DbBrainItem extends Owned {
  category: BrainCategoryId;
  kind: BrainItemKind;
  /** i18n key for seeded items; null for captured ones. */
  seedKey: string | null;
  title: string | null;
  detail: string | null;
  done: boolean;
  ai: boolean;
}

/**
 * A synapse: two notes the person — or an accepted suggestion — connected.
 * Undirected, stored once with the smaller id first (see `canonicalPair`).
 */
export interface DbBrainLink extends Owned {
  fromId: string;
  toId: string;
  /** Why they belong together, in the person's words or the matcher's. */
  reason: string | null;
  origin: "user" | "suggested";
}

export interface Dataset {
  projects: DbProject[];
  deals: DbDeal[];
  transactions: DbTransaction[];
  tasks: DbTask[];
  brain: DbBrainItem[];
  links: DbBrainLink[];
}

export type Collection = keyof Dataset;

/**
 * Who the person is, as told during onboarding and edited in Settings.
 *
 * One row per person, not a collection. Goals and first thoughts are *not*
 * kept here: they become notes in the brain, where the person can edit or
 * delete them. A copy in the profile would outlive that deletion and keep
 * feeding the assistant something the person had removed.
 */
export interface DbProfile {
  userKey: string;
  name: string | null;
  profession: string | null;
  /** Structured answers that have no home in the brain — see `ProfileAnswers`. */
  answers: Record<string, unknown>;
  /** When onboarding first completed. Never moved by a re-run. */
  onboardedAt: string | null;
  updatedAt: string;
}

export type ProfilePatch = Partial<Pick<DbProfile, "name" | "profession" | "answers" | "onboardedAt">>;

/** The contract both adapters implement. */
export interface Store {
  readonly backend: "supabase" | "local";
  /** The person's profile, or null if they have none yet. */
  getProfile(userKey: string): Promise<DbProfile | null>;
  /** Creates or updates the profile; fields absent from `patch` are kept. */
  saveProfile(userKey: string, patch: ProfilePatch): Promise<DbProfile>;
  /** Erases everything the person owns: every collection, and the profile. */
  clear(userKey: string): Promise<void>;
  list<C extends Collection>(userKey: string, collection: C): Promise<Dataset[C]>;
  insert<C extends Collection>(
    userKey: string,
    collection: C,
    row: Omit<Dataset[C][number], "id" | "userKey" | "createdAt">
  ): Promise<Dataset[C][number]>;
  update<C extends Collection>(
    userKey: string,
    collection: C,
    id: string,
    patch: Partial<Dataset[C][number]>
  ): Promise<void>;
  remove(userKey: string, collection: Collection, id: string): Promise<void>;
}
