import { normalize } from "./text";
import type { BrainCategoryId } from "@/lib/data/brain";

/**
 * Keyword routing for a captured thought — used with no AI key, or when the
 * model fails, so a capture is never lost to an outage.
 *
 * Runs on accent-stripped text. JavaScript's `\b` treats "é" and "à" as
 * non-word characters, so a pattern like `\bidée\b` can never match "idée"
 * (there is no word boundary after the "é"), and `\bécrire` never matches at
 * the start of a sentence. The previous heuristic had exactly that bug: half
 * its French vocabulary was dead. Normalising first makes every pattern ASCII.
 *
 * Order matters: goals are checked before next steps because a goal usually
 * contains an action verb ("atteindre", "reach").
 */
const RULES: [BrainCategoryId, RegExp][] = [
  ["goals", /\b(objectif|goal|atteindre|reach|d'ici|by (the )?end of|devenir|become|ambition)\b/],
  [
    "next",
    /\b(todo|to-do|a faire|ship|call|email|fix|envoyer|appeler|finish|finir|reply|repondre|relancer|ecrire|write|book|reserver|preparer|prepare)\b/,
  ],
  ["ideas", /\b(idea|idee|what if|et si|concept|feature|maybe|peut-etre)\b/],
  ["knowledge", /\b(learned|appris|noted|fact|remember|retenir|source|according to|selon)\b/],
  ["insights", /\b(realised|realized|compris|understood|insight|je realise|i realise)\b/],
];

export function heuristicRegion(text: string): BrainCategoryId {
  const t = normalize(text);
  for (const [region, pattern] of RULES) if (pattern.test(t)) return region;
  return "thoughts";
}
