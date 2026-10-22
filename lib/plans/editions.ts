import type { AreaId } from "@/lib/onboarding";

/**
 * The three editions of LifeOS, and what each one opens.
 *
 *  - Personnel: a second brain and a double for one's own life — capture,
 *    connections, maps, voice, reminders, the island, the assistant, and an
 *    agent that works on all of it.
 *  - Solo / Entrepreneur: everything above, and the business it runs —
 *    projects, clients, finance and runway, the Friday review, the investor
 *    update; the agent works on those too, runs on a server and on Telegram.
 *  - Équipe: everything above, for a company — team spaces with a shared
 *    brain, verified domains, single sign-on, directory provisioning, the
 *    data processing agreement.
 *
 * Every feature has one home, and each edition contains the one before it,
 * so "can this person use X" is one lookup — done on the server for every
 * write (`lib/plans/server.ts`), not only by hiding a link.
 */

export const EDITIONS = ["personal", "solo", "team"] as const;
export type Edition = (typeof EDITIONS)[number];

export const isEdition = (v: unknown): v is Edition => typeof v === "string" && (EDITIONS as readonly string[]).includes(v);

export const FEATURES = [
  // Personnel
  "brain",
  "double",
  "maps",
  "voice",
  "reminders",
  "hub",
  "assistant",
  "dashboard",
  "agent",
  "circles",
  // Solo / Entrepreneur
  "projects",
  "crm",
  "finance",
  "review",
  "reports",
  "notion",
  "agent.business",
  "agent.runner",
  // Équipe
  "teams",
  "enterprise",
] as const;
export type Feature = (typeof FEATURES)[number];

/** The edition where each feature first appears. */
export const HOME: Record<Feature, Edition> = {
  brain: "personal",
  double: "personal",
  maps: "personal",
  voice: "personal",
  reminders: "personal",
  hub: "personal",
  assistant: "personal",
  dashboard: "personal",
  agent: "personal",
  circles: "personal",
  projects: "solo",
  crm: "solo",
  finance: "solo",
  review: "solo",
  reports: "solo",
  notion: "solo",
  "agent.business": "solo",
  "agent.runner": "solo",
  teams: "team",
  enterprise: "team",
};

const RANK: Record<Edition, number> = { personal: 0, solo: 1, team: 2 };

export const includes = (edition: Edition, feature: Feature): boolean => RANK[edition] >= RANK[HOME[feature]];

/** The smallest edition that opens a feature. */
export const editionFor = (feature: Feature): Edition => HOME[feature];

export const featuresOf = (edition: Edition): Feature[] => FEATURES.filter((f) => includes(edition, f));

/** What each edition adds to the one before it, in order. */
export const addedBy = (edition: Edition): Feature[] => FEATURES.filter((f) => HOME[f] === edition);

/**
 * How much the agent may do in a day, and how many steps one request may
 * take. Bounds on cost and on runaway loops, not on what it can reach.
 */
export const LIMITS: Record<Edition, { agentRunsPerDay: number; agentSteps: number }> = {
  personal: { agentRunsPerDay: 25, agentSteps: 8 },
  solo: { agentRunsPerDay: 100, agentSteps: 16 },
  team: { agentRunsPerDay: 300, agentSteps: 24 },
};

/** Which navigation entries belong to which feature. */
export const NAV_FEATURE: Record<string, Feature> = {
  hub: "hub",
  brain: "brain",
  assistant: "assistant",
  agent: "agent",
  team: "circles",
  dashboard: "dashboard",
  projects: "projects",
  crm: "crm",
  finance: "finance",
  review: "review",
  reports: "reports",
};

/**
 * The edition to suggest from the parts of life someone said the brain
 * should help with: a team → Équipe; clients, projects or money → Solo;
 * otherwise Personnel. A suggestion, changed in one click.
 */
export function suggestEdition(areas: readonly AreaId[]): Edition {
  if (areas.includes("team")) return "team";
  if (areas.some((a) => a === "clients" || a === "projects" || a === "money")) return "solo";
  return "personal";
}

/** A subscription plan as an edition — legacy plan names included. */
export function editionOfPlan(plan: unknown): Edition | null {
  if (isEdition(plan)) return plan;
  if (plan === "starter" || plan === "essential") return "personal";
  if (plan === "pro") return "solo";
  if (plan === "founder" || plan === "sovereign" || plan === "enterprise") return "team";
  return null;
}

/** Stripe statuses under which a subscription still opens its edition (past_due: Stripe is retrying the card). */
export const PAID_STATUSES = ["active", "trialing", "past_due"] as const;

export interface EditionState {
  /** What the person can use now. */
  edition: Edition;
  /** What they chose; null if they never did. */
  chosen: Edition | null;
  /** What their subscription pays for; null without one, or while billing is off. */
  entitled: Edition | null;
  /** Whether payment decides — false during early access. */
  billing: boolean;
}

/**
 * The edition in use.
 *
 * During early access every edition is free: the one chosen, and for
 * someone who never chose — every account from before the editions — the
 * full one, so nobody loses what they had.
 *
 * Once billing decides, the subscription is a ceiling: the chosen edition
 * if it is paid for, the paid one otherwise, and Personnel without a
 * subscription. Whether Personnel stays free then is a pricing decision;
 * this is the one place to change it.
 */
export function resolveEdition(chosen: Edition | null, entitled: Edition | null, billing: boolean): Edition {
  if (!billing) return chosen ?? "team";
  const paid = entitled ?? "personal";
  const wanted = chosen ?? paid;
  return RANK[wanted] <= RANK[paid] ? wanted : paid;
}

export const rank = (edition: Edition): number => RANK[edition];
