import { z } from "zod";
import { DEPTHS, SPECIALIST_LIMITS, SPECIALIST_TOOLS, type Depth, type SpecialistTool } from "./constants";

/**
 * Specialists: sub-agents the owner defines for their own needs — a lawyer's
 * eye on French contracts, an accountant for their VAT, a writer in their
 * voice, a researcher on their market.
 *
 * A specialist is a role and a boundary, nothing more: its instructions (what
 * it is for, how it works), the tools it may use, and how deeply it thinks.
 * It never has more than the agent itself — its tools are cut down to what
 * the owner's edition and this server offer on every request — and the rules
 * no tool result can change come after its instructions and prevail over them
 * (`prompt.ts`). It cannot create other agents or send its own work to more of
 * them: orchestration stays with the main agent.
 */

export { DEPTHS, SPECIALIST_LIMITS, SPECIALIST_TOOLS } from "./constants";
export type { Depth, SpecialistTool } from "./constants";

export interface Specialist {
  id: string;
  name: string;
  /** When the main agent should call it — and what the owner reads in the list. */
  description: string;
  /** Its role and how it works, in the owner's words. */
  instructions: string;
  tools: SpecialistTool[];
  depth: Depth;
  createdAt: string;
  updatedAt: string;
}

export type SpecialistInput = Pick<Specialist, "name" | "description" | "instructions" | "tools" | "depth">;

const TOOL_SET = new Set<string>(SPECIALIST_TOOLS);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * A specialist as stored, made safe to run: the page validates what it saves,
 * but a row can be written past the page (the owner's own API access to their
 * rows, an edited local file). Whatever was written, what runs has only tools
 * a specialist may have, a known depth, and bounded text.
 */
export function fromStored(raw: { id: string; createdAt: string; updatedAt: string } & Record<string, unknown>): Specialist {
  const tools = Array.isArray(raw.tools) ? [...new Set(raw.tools.filter((t): t is SpecialistTool => typeof t === "string" && TOOL_SET.has(t)))] : [];
  return {
    id: raw.id,
    name: text(raw.name, SPECIALIST_LIMITS.name) || "?",
    description: text(raw.description, SPECIALIST_LIMITS.description),
    instructions: text(raw.instructions, SPECIALIST_LIMITS.instructions),
    tools,
    depth: (DEPTHS as readonly unknown[]).includes(raw.depth) ? (raw.depth as Depth) : "balanced",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

const line = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

export const specialistSchema = z.object({
  name: line(SPECIALIST_LIMITS.name),
  description: line(SPECIALIST_LIMITS.description),
  instructions: z.string().trim().min(1).max(SPECIALIST_LIMITS.instructions),
  // Unknown or orchestration tools are refused, not dropped: what was asked for is what is saved.
  tools: z
    .array(z.enum(SPECIALIST_TOOLS))
    .max(SPECIALIST_TOOLS.length)
    .transform((t) => [...new Set(t)]),
  depth: z.enum(DEPTHS),
});
