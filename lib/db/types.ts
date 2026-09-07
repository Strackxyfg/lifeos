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

export interface Dataset {
  projects: DbProject[];
  deals: DbDeal[];
  transactions: DbTransaction[];
  tasks: DbTask[];
  brain: DbBrainItem[];
}

export type Collection = keyof Dataset;

/** The contract both adapters implement. */
export interface Store {
  readonly backend: "supabase" | "local";
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
