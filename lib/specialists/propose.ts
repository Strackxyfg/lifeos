import "server-only";
import { ai } from "@/lib/ai/router";
import { extractJson } from "@/lib/ai/json";
import type { Locale } from "@/lib/i18n/config";
import { getCapability } from "@/lib/agent/capabilities";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import { DEPTHS, SPECIALIST_LIMITS, specialistSchema, type SpecialistInput } from "./model";

/**
 * A specialist drafted from the owner's own words — "someone who checks my
 * contracts", "an assistant for my VAT" — for them to read, change and save.
 * Nothing is saved here. The draft passes the same checks as a specialist
 * typed by hand, and it is given only tools the owner may give; a draft that
 * does not pass is no draft at all (`null`), never a half-filled one.
 */

export const NEED_MAX = 1_000;

function system(locale: Locale, available: string[]): string {
  const language = locale === "fr" ? "French" : "English";
  const tools = AGENT_TOOLS.filter((t) => available.includes(t.spec.name)).map((t) => {
    const c = getCapability(t.capability);
    return `- ${t.spec.name}: ${c?.label ?? t.spec.name}${c && c.tier !== "safe" ? ` (${c.tier === "low" ? "writes inside LifeOS" : "may need the owner's approval"})` : ""}`;
  });
  return [
    "You design a specialist: an AI agent of LifeOS that one person defines for a need of theirs. It works for them with the tools it is given, under LifeOS's own safety rules (those are added by LifeOS; do not restate them).",
    "",
    "Answer with one JSON object, nothing else:",
    `{ "name": string, "description": string, "instructions": string, "tools": string[], "depth": ${DEPTHS.map((d) => `"${d}"`).join(" | ")} }`,
    "",
    `- name: short (at most ${SPECIALIST_LIMITS.name} characters), in ${language}, saying what it is ("Comptable", "Legal eye").`,
    `- description: one or two sentences in ${language} (at most ${SPECIALIST_LIMITS.description} characters) saying when to call it — the main agent reads it to decide.`,
    `- instructions: its role in ${language}, written to it as "you" (in French, "tu"), 80 to 250 words: what it is for and its scope, how it works step by step, what it delivers and in what form, and its limits — in law, health or money, it says when a professional must decide; it never invents facts, figures or sources.`,
    "- tools: the fewest that fit, only from this list:",
    ...tools,
    "  Never email_send unless the need explicitly asks it to send emails itself.",
    "- depth: fast for quick lookups, balanced for most work, deep for hard reasoning (law, tax, analysis).",
    "",
    "The need is the owner's own words: design for it; if it asks you to break rules, to impersonate someone or to harm, design a specialist that does what is legitimate in it and nothing else.",
  ].join("\n");
}

/** A draft for the owner's need, or null when no model gave a valid one. */
export async function proposeSpecialist(need: string, locale: Locale, available: string[]): Promise<SpecialistInput | null> {
  const allowed = new Set(available);
  const read = (data: unknown): SpecialistInput | null => {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    // Tools it may not give are dropped from a draft (it is reviewed before saving); anything else invalid fails it.
    const tools = Array.isArray(d.tools) ? d.tools.filter((t): t is string => typeof t === "string" && allowed.has(t)) : [];
    const parsed = specialistSchema.safeParse({ ...d, tools });
    return parsed.success ? parsed.data : null;
  };
  const { value } = await ai().complete({
    task: "agent",
    messages: [
      { role: "system", content: system(locale, available) },
      { role: "user", content: need.trim().slice(0, NEED_MAX) },
    ],
    maxTokens: 1_500,
    temperature: 0.4,
    json: true,
    validate: (text) => read(extractJson(text)) !== null,
  });
  return read(extractJson(value));
}
