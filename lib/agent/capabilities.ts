/**
 * What the agent is allowed to attempt, and how dangerous each action is.
 *
 * Risk tiers drive the policy engine in `policy.ts`. The catalogue is
 * deliberately explicit: anything not listed here is unknown, and unknown
 * actions are denied.
 */

export type RiskTier =
  /** Read-only, no side effects. */
  | "safe"
  /** Writes inside LifeOS only. Reversible, private. */
  | "low"
  /** Writes to the user's connected tools (Notion, calendar). Reversible. */
  | "medium"
  /** Leaves the user's control: messages, external calls, code execution. */
  | "high"
  /** Never permitted to an autonomous agent, whatever the profile. */
  | "forbidden";

export interface Capability {
  id: string;
  tier: RiskTier;
  /** Shown in the approval card and the audit log. */
  label: string;
  labelFr: string;
  /** Why it carries this tier — surfaced in the UI so the rating is auditable. */
  rationale: string;
}

export const CAPABILITIES: Capability[] = [
  // ── Read-only ──────────────────────────────────────────────────────
  { id: "brain.read", tier: "safe", label: "Read your second brain", labelFr: "Lire votre second cerveau", rationale: "No side effects." },
  { id: "workspace.read", tier: "safe", label: "Read projects, deals and finance", labelFr: "Lire projets, opportunités et finances", rationale: "No side effects." },
  { id: "analyze", tier: "safe", label: "Analyse and summarise", labelFr: "Analyser et résumer", rationale: "Computation only." },

  // ── Internal writes ────────────────────────────────────────────────
  { id: "brain.write", tier: "low", label: "Capture notes and ideas", labelFr: "Capturer notes et idées", rationale: "Private to LifeOS, reversible." },
  { id: "task.write", tier: "low", label: "Create and update tasks", labelFr: "Créer et modifier des tâches", rationale: "Private to LifeOS, reversible." },
  { id: "project.write", tier: "low", label: "Create and update projects", labelFr: "Créer et modifier des projets", rationale: "Private to LifeOS, reversible." },

  // ── Connected tools ────────────────────────────────────────────────
  { id: "notion.write", tier: "medium", label: "Write into your Notion", labelFr: "Écrire dans votre Notion", rationale: "Changes a system outside LifeOS, but recoverable from Notion trash." },
  { id: "calendar.write", tier: "medium", label: "Create calendar events", labelFr: "Créer des événements d'agenda", rationale: "Visible to invitees; reversible." },

  // ── Leaves the user's control ──────────────────────────────────────
  { id: "email.send", tier: "high", label: "Send email on your behalf", labelFr: "Envoyer un e-mail en votre nom", rationale: "Irreversible once sent, and speaks as you." },
  { id: "message.send", tier: "high", label: "Post to Slack or chat", labelFr: "Publier sur Slack ou messagerie", rationale: "Irreversible, visible to others." },
  { id: "http.external", tier: "high", label: "Call an external service", labelFr: "Appeler un service externe", rationale: "Can exfiltrate data or trigger third-party effects." },
  { id: "code.run", tier: "high", label: "Execute code", labelFr: "Exécuter du code", rationale: "Arbitrary effects inside the sandbox." },

  // ── Never ──────────────────────────────────────────────────────────
  { id: "payment", tier: "forbidden", label: "Move money", labelFr: "Déplacer de l'argent", rationale: "Financial actions always belong to a human." },
  { id: "credentials.read", tier: "forbidden", label: "Read secrets or tokens", labelFr: "Lire secrets ou jetons", rationale: "No legitimate agent task requires raw credentials." },
  { id: "data.delete", tier: "forbidden", label: "Permanently delete data", labelFr: "Supprimer définitivement des données", rationale: "Unrecoverable; archiving is offered instead." },
  { id: "account.modify", tier: "forbidden", label: "Change account or security settings", labelFr: "Modifier le compte ou la sécurité", rationale: "Would let the agent widen its own permissions." },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id: string): Capability | undefined {
  return BY_ID.get(id);
}

/** Tiers ordered from least to most dangerous. */
export const TIER_ORDER: RiskTier[] = ["safe", "low", "medium", "high", "forbidden"];

export function tierRank(tier: RiskTier): number {
  return TIER_ORDER.indexOf(tier);
}
