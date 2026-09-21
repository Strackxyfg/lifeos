import { CAPABILITIES, type Capability } from "./capabilities";

/**
 * The capability catalogue, expressed as MCP tools.
 *
 * Hermes (or any MCP client) discovers what LifeOS can do from here. Two rules
 * shape the list:
 *
 *  1. `forbidden` capabilities are not published. A tool that can only ever
 *     fail is noise in a model's context, and advertising "move money" invites
 *     the model to keep trying it.
 *  2. Publishing a tool is not permission to run it. Every call still goes
 *     through the same policy engine, so a `high`-tier tool listed here comes
 *     back as "queued for approval" rather than being executed.
 */

/**
 * MCP revisions this server speaks, oldest first.
 * The last entry is what we answer with when a client asks for something we
 * do not recognise.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;

/**
 * Echo the client's protocol version when we understand it.
 *
 * Answering with our own regardless makes a client that speaks an older
 * revision give up at the handshake — which looks like "the server is broken"
 * rather than "we disagree about a version".
 */
export function negotiateProtocolVersion(requested: unknown): string {
  const asked = String(requested ?? "");
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
    ? asked
    : SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** MCP tool names allow `[a-z0-9_-]`; capability ids use dots. */
export function toToolName(capabilityId: string): string {
  return capabilityId.replace(/\./g, "_");
}

export function fromToolName(toolName: string): string | undefined {
  return CAPABILITIES.find((c) => toToolName(c.id) === toolName)?.id;
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

/** Payload shape per capability, so the model sends usable arguments. */
const SCHEMAS: Record<string, McpTool["inputSchema"]> = {
  "brain.write": {
    type: "object",
    properties: {
      title: str("The note, idea or insight. One clear sentence."),
      detail: str("Optional longer body."),
      category: str("One of: goals, next, ideas, thoughts, knowledge, insights."),
    },
    required: ["title"],
  },
  "brain.search": {
    type: "object",
    properties: { query: str("Words to look for. Accent-insensitive; every word must match.") },
    required: ["query"],
  },
  "brain.link": {
    type: "object",
    properties: {
      a: str("Id of the first note, as shown in brain_read or brain_search."),
      b: str("Id of the second note."),
      reason: str("Why they belong together, in one short sentence."),
    },
    required: ["a", "b"],
  },
  "task.write": {
    type: "object",
    properties: { label: str("What needs doing, phrased as an action.") },
    required: ["label"],
  },
  "project.write": {
    type: "object",
    properties: {
      name: str("Project name."),
      status: str("One of: Planning, In progress, Blocked, Done."),
      owner: str("Who owns it."),
      due: str("Due date, free text."),
    },
    required: ["name"],
  },
  "deal.write": {
    type: "object",
    properties: {
      name: str("Deal name."),
      company: str("Counterparty."),
      stage: str("One of: Lead, Qualified, Proposal, Won, Lost."),
      value: num("Deal value in your currency."),
      next: str("The next concrete step."),
    },
    required: ["name"],
  },
  "email.draft": {
    type: "object",
    properties: {
      to: str("Recipient email address."),
      subject: str("Subject line."),
      body: str("The complete email body. Write it in full — never a placeholder."),
    },
    required: ["body"],
  },
  "campaign.draft": {
    type: "object",
    properties: {
      audience: str("Who the campaign targets."),
      subject: str("Campaign name or headline."),
      body: str("Full ad copy, channel, and the budget you are requesting."),
      meta: { type: "object", description: "Structured extras: budget, channel, UTM." },
    },
    required: ["body"],
  },
  "proposal.draft": {
    type: "object",
    properties: {
      target: str("Prospect or company."),
      subject: str("Proposal title."),
      body: str("The complete proposal: scope, price, terms."),
    },
    required: ["body"],
  },
  "email.send": {
    type: "object",
    properties: {
      to: str("Recipient email address."),
      subject: str("Subject line."),
      body: str("The complete email body."),
    },
    required: ["to", "subject", "body"],
  },
  "ads.launch": {
    type: "object",
    properties: {
      audience: str("Targeting."),
      body: str("Ad copy."),
      budgetCents: num("Requested spend, in cents."),
      channel: str("Ad platform."),
    },
    required: ["body", "budgetCents"],
  },
  "web.research": {
    type: "object",
    properties: { url: str("A public page to read.") },
    required: ["url"],
  },
};

const GENERIC: McpTool["inputSchema"] = {
  type: "object",
  properties: { intent: str("What you are trying to achieve.") },
};

function describe(cap: Capability): string {
  const gate =
    cap.tier === "high"
      ? " Requires the owner's approval before it runs — expect a 'queued for approval' answer, not an immediate effect."
      : cap.tier === "medium"
        ? " Touches a system outside LifeOS."
        : "";
  return `${cap.label}. ${cap.rationale}${gate}`;
}

export function listMcpTools(): McpTool[] {
  return CAPABILITIES.filter((c) => c.tier !== "forbidden").map((cap) => ({
    name: toToolName(cap.id),
    description: describe(cap),
    inputSchema: SCHEMAS[cap.id] ?? GENERIC,
  }));
}
