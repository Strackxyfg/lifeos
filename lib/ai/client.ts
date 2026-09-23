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
    "Prefer short paragraphs or tight bullet lists. Never exceed ~90 words unless asked.",
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
