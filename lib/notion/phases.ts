/**
 * Canonical generation phases — the single source of truth shared by the
 * server stream (`/api/generate/stream`) and the client generation UI.
 * Pure data + a pure formatter, so it's safe to import on both sides.
 */
export interface GenPhase {
  key: string;
  label: string;
  ms: number;
  detail: (plan: string[]) => string;
}

export const genPhases: GenPhase[] = [
  { key: "workspace", label: "Creating your Notion workspace", ms: 1400, detail: () => "Provisioning a private top-level page" },
  { key: "databases", label: "Building databases", ms: 2600, detail: (p) => `${p.length} databases · ${p.join(", ")}` },
  { key: "relations", label: "Wiring relations & rollups", ms: 2000, detail: () => "Projects ↔ Tasks ↔ Goals ↔ Week" },
  { key: "dashboards", label: "Composing dashboards", ms: 1800, detail: () => "Home, This Week, and per-area views" },
  { key: "templates", label: "Generating templates", ms: 1600, detail: () => "Project, meeting, and journal templates" },
  { key: "automations", label: "Setting up automations", ms: 1600, detail: () => "Status rollups & recurring rules" },
  { key: "calendars", label: "Connecting calendars", ms: 1400, detail: () => "Google & Apple Calendar sync" },
  { key: "kpis", label: "Computing KPIs", ms: 1400, detail: () => "Revenue, focus, and streak metrics" },
  { key: "recurring", label: "Scheduling recurring tasks", ms: 1200, detail: () => "Daily standup, weekly review" },
  { key: "assistant", label: "Training your AI assistant", ms: 1800, detail: () => "Personalized to your goals" },
];

/** A single streamed event over SSE. */
export interface GenStreamEvent {
  index: number;
  total: number;
  label?: string;
  detail?: string;
  progress: number;
  state: "active" | "done" | "error";
  plan?: string[];
  /** `live` = really written into Notion; `simulated` = no credentials. */
  mode?: "live" | "simulated";
  workspaceUrl?: string;
}
