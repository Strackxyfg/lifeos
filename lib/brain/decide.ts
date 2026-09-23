/**
 * From a tension to a decision.
 *
 * Two notes in tension — "travel more this year" and "save for the flat" —
 * are the most valuable thing a second brain can surface, and the least
 * useful if they just sit in a list. A decision closes them: written by the
 * person (optionally from options the model proposes), saved as a note of its
 * own, connected to both sides, and marked as what resolved the tension.
 *
 * This module validates the model's options. Pure; never throws.
 *
 * The options carry no "keeps side A / B" label. The model was asked for one
 * and got it wrong two times in three on a real tension ("I postpone the
 * half-marathon" labelled as keeping the half-marathon): a wrong label is
 * worse than none. Which side to set aside is the person's call, in the form.
 */

export interface DecisionOption {
  /** The decision, as the person would write it. */
  title: string;
  /** Why, from their notes. */
  why: string;
}

export const DECISION_LIMITS = { options: 3, title: 200, why: 300 } as const;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function sanitizeOptions(raw: unknown): DecisionOption[] {
  const data = (raw && typeof raw === "object" ? raw : {}) as { options?: unknown };
  const list = Array.isArray(raw) ? raw : Array.isArray(data.options) ? data.options : [];
  const out: DecisionOption[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? clip(oneLine(o.title), DECISION_LIMITS.title) : "";
    if (title.length < 3) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, why: typeof o.why === "string" ? clip(oneLine(o.why), DECISION_LIMITS.why) : "" });
    if (out.length === DECISION_LIMITS.options) break;
  }
  return out;
}
