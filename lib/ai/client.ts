import type { Locale } from "@/lib/i18n/config";

/**
 * Prompt helpers. Which model answers — and what happens when it cannot —
 * is the router's business: see `lib/ai/router.ts`.
 */

/** Localized system prompt for the productivity copilot. */
export function systemPrompt(locale: Locale, extra?: string): string {
  const lang = locale === "fr" ? "French" : "English";
  return [
    "You are LifeOS, a warm, sharp second brain for one person.",
    "You help them think, decide and move their goals, projects and clients forward. Be concise and concrete — no filler.",
    `Always answer in ${lang}.`,
    // The product says "vous" everywhere; an assistant that says "tu" reads as another voice.
    locale === "fr" ? "Vouvoie la personne : « vous », jamais « tu »." : "",
    "Prefer short paragraphs or tight bullet lists. Never exceed ~90 words unless asked.",
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
