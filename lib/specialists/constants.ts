/**
 * The fixed lists and limits of specialists — apart from `model.ts` (which
 * re-exports them) so that a page can show them without bringing the
 * validation library into the browser.
 */

/** Tools a specialist may be given: every agent tool except those that orchestrate other agents. */
export const SPECIALIST_TOOLS = [
  "brain_search",
  "brain_overview",
  "brain_note",
  "self_portrait",
  "workspace_overview",
  "sales_overview",
  "web_search",
  "web_read",
  "compute",
  "note_create",
  "notes_connect",
  "task_create",
  "reminder_create",
  "project_create",
  "deal_create",
  "sales_draft",
  "email_draft",
  "proposal_draft",
  "email_send",
] as const;
export type SpecialistTool = (typeof SPECIALIST_TOOLS)[number];

/** How deeply it thinks: the models it is given (`lib/ai/router.ts`, MODEL_RANK). */
export const DEPTHS = ["fast", "balanced", "deep"] as const;
export type Depth = (typeof DEPTHS)[number];

export const SPECIALIST_LIMITS = {
  name: 40,
  description: 300,
  instructions: 6_000,
  /** Per person — a working team, not a crowd; the database holds the same cap. */
  count: 30,
} as const;
