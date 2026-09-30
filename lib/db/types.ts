import type { ProjectStatus, DealStage, TxnType } from "@/lib/data/workspace";
import type { BrainCategoryId, BrainItemKind } from "@/lib/data/brain";
import type { Concept } from "@/lib/brain/concepts";
import type { LinkOrigin, RelationKind } from "@/lib/brain/relations";
import type { AudioWord } from "@/lib/voice/align";
import type { Repeat } from "@/lib/reminders/schedule";
import type { Dimension, Evidence, TraitOrigin, TraitStatus } from "@/lib/self/portrait";

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
  /** Migration 013: when the next action is due (ISO instant), if said. */
  nextAt?: string | null;
}

export interface DbTransaction extends Owned {
  item: string;
  type: TxnType;
  amount: number;
  category: string;
  /** As typed ("Jul 26"): free text, kept for display. */
  date: string;
  /** Migration 013: the real day (YYYY-MM-DD), once confirmed. Treasury and runway count only these. */
  occurredOn?: string | null;
}

/** Migration 013: a cash balance as the person stated it — the anchor of the treasury. */
export interface DbBalance extends Owned {
  amount: number;
  /** The day it was true (YYYY-MM-DD). */
  asOf: string;
  note: string | null;
}

/** A decision taken in a weekly review: what, why, and when to look at it again. */
export interface ReviewDecision {
  id: string;
  text: string;
  why: string;
  /** YYYY-MM-DD, or null for "no need to revisit". */
  revisitOn: string | null;
  /** The reminder set for that day, once created. */
  reminderId?: string | null;
}

/** Migration 013: the Friday review of one ISO week (keyed by its Monday). */
export interface DbReview extends Owned {
  weekStart: string;
  wins: string;
  blockers: string;
  lessons: string;
  focus: string;
  decisions: ReviewDecision[];
  updatedAt: string;
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
  /** What the note is about (migration 008). Absent before its first analysis. */
  concepts?: Concept[];
  /** Fingerprint of the text the concepts were read from — see `contentHash`. */
  conceptsHash?: string | null;
  /** Spaced review (migration 009): the day it is next due, the interval, the last review. */
  reviewDue?: string | null;
  reviewInterval?: number | null;
  reviewedAt?: string | null;
  /** Migration 010: the recording this note was said in, and the passage (ms) it plays. */
  audioId?: string | null;
  audioStartMs?: number | null;
  audioEndMs?: number | null;
}

/** A recording kept with the notes said in it (migration 010). */
export interface DbBrainAudio extends Owned {
  /** Where the file is stored, inside the owner's folder: "<folder>/<file>". */
  path: string;
  mime: string;
  bytes: number;
  durationMs: number;
  language: string | null;
  /** Word by word, with times in milliseconds. */
  transcript: AudioWord[];
}

/**
 * A synapse between two notes. Stored once with the smaller id first (see
 * `canonicalPair`); a directed relation keeps its direction in `sourceId`.
 */
export interface DbBrainLink extends Owned {
  fromId: string;
  toId: string;
  /** Why they belong together, in the person's words or the engine's. */
  reason: string | null;
  origin: LinkOrigin;
  /** Migration 008. Absent on older rows, and read as "related". */
  kind?: RelationKind;
  /** The note a directed relation starts from — one of the two ends, or null. */
  sourceId?: string | null;
  /** Migration 009: the decision note that resolved this tension. */
  resolvedBy?: string | null;
}

/** A pair of notes the person said are not related — never proposed again. */
export interface DbBrainDismissal extends Owned {
  fromId: string;
  toId: string;
}

/**
 * A reminder (migration 011). It keeps the clock of the zone it was set in:
 * "every day at 9" is 9 there, winter and summer.
 */
export interface DbReminder extends Owned {
  title: string;
  /** When it is next due. */
  dueAt: string;
  /** The first occurrence: a series is counted from it, so the 31st stays the 31st. */
  anchorAt: string;
  repeat: Repeat;
  /** The IANA time zone whose clock it keeps. */
  zone: string;
  done: boolean;
  doneAt: string | null;
  /** The note it is about, if any; cleared if that note is deleted. */
  noteId: string | null;
  /** When the person was last told of this occurrence — so it is never told twice. */
  notifiedAt: string | null;
  /** Migration 013: the deal whose next action this is; cleared if the deal is deleted. */
  dealId?: string | null;
}

/**
 * Migration 015: a trait of the person's portrait — what their double has
 * understood of them, resting on their own words (see `lib/self/portrait.ts`).
 */
export interface DbTrait extends Owned {
  dimension: Dimension;
  /** One sentence, addressed to them ("Vous travaillez mieux le matin"). */
  statement: string;
  /** The passages of their notes it rests on. */
  evidence: Evidence[];
  status: TraitStatus;
  origin: TraitOrigin;
  /** The statement's meaningful words, normalised: how the same trait is recognised. */
  key: string;
  updatedAt: string;
}

/** Migration 015: how they were (mood, energy, 1–5) and the day's question they answered. */
export interface DbCheckin extends Owned {
  at: string;
  /** Their own calendar day (YYYY-MM-DD) and hour when they checked in — fixed then. */
  day: string;
  hour: number;
  mood: number | null;
  energy: number | null;
  questionId: string | null;
  /** The note the answer became; cleared if that note is deleted. */
  noteId: string | null;
}

/** Migration 015: what the person did with a piece of advice. */
export interface DbAdviceState extends Owned {
  adviceKey: string;
  status: "dismissed" | "snoozed" | "done";
  until: string | null;
  updatedAt: string;
}

export interface Dataset {
  projects: DbProject[];
  deals: DbDeal[];
  transactions: DbTransaction[];
  tasks: DbTask[];
  brain: DbBrainItem[];
  links: DbBrainLink[];
  dismissals: DbBrainDismissal[];
  audio: DbBrainAudio[];
  reminders: DbReminder[];
  balances: DbBalance[];
  reviews: DbReview[];
  traits: DbTrait[];
  checkins: DbCheckin[];
  advice: DbAdviceState[];
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
  /**
   * Whether migration 008 has been applied: typed connections, concepts on
   * notes, and dismissals. The connection engine needs all three and stays
   * off without them.
   */
  supportsSynapses(): Promise<boolean>;
  /**
   * Whether migration 009 has been applied: spaced review on notes, and
   * tensions resolved by a decision.
   */
  supportsMemory(): Promise<boolean>;
  /** Whether migration 010 has been applied: recordings kept, with their storage. */
  supportsVoice(): Promise<boolean>;
  /** Whether migration 011 has been applied: reminders. */
  supportsReminders(): Promise<boolean>;
  /**
   * Whether migration 013 has been applied: dated transactions, balances,
   * deals' next moments and reminders about them, weekly reviews.
   */
  supportsFounder(): Promise<boolean>;
  /** Whether migration 015 has been applied: the double — portrait, check-ins, advice. */
  supportsSelf(): Promise<boolean>;
  /** One row by id, if it belongs to the caller. */
  get<C extends Collection>(userKey: string, collection: C, id: string): Promise<Dataset[C][number] | null>;
  /** Stores a recording in the person's own folder; returns the path to keep. `file` is "<id>.<ext>". */
  putAudio(userKey: string, file: string, bytes: Uint8Array, mime: string): Promise<string>;
  /** A recording's bytes — only from the person's own folder. */
  getAudio(userKey: string, path: string): Promise<Uint8Array | null>;
  /** Deletes recordings — only from the person's own folder. */
  removeAudio(userKey: string, paths: string[]): Promise<void>;
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
