/**
 * The Notion build's steps and stream events — shared by the server stream
 * (`/api/generate/stream`) and the progress screen. Pure data, safe to import
 * on both sides; the labels live in i18n (`notionBuild.steps`).
 *
 * Exactly the steps the generator performs, in order. The progress screen
 * shows these and nothing else: it used to list "Setting up automations",
 * "Connecting calendars", "Computing KPIs" and "Training your AI assistant" —
 * none of which happened — and tick them off.
 */
export const GENERATION_STEPS = ["verify", "databases", "relations", "home", "seed"] as const;
export type GenerationStep = (typeof GENERATION_STEPS)[number];

/** A single event on the build stream. */
export type GenStreamEvent =
  | {
      state: "active";
      step: GenerationStep;
      /** 0..1 */
      progress: number;
      /** The database being created, during the `databases` step. */
      db?: string;
    }
  | { state: "done"; databases: number; workspaceUrl?: string }
  | { state: "error"; code: "not_connected" | "failed"; message?: string };
