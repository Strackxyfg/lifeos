import OpenAI from "openai";
import type { Locale } from "@/lib/i18n/config";

/**
 * AI provider abstraction. Groq and Cerebras both expose OpenAI-compatible
 * chat completions, so we reuse the `openai` SDK with a custom baseURL.
 * Choose with AI_PROVIDER=groq|cerebras; falls back gracefully with no key.
 */
export type AIProvider = "groq" | "cerebras";

const PROVIDERS: Record<AIProvider, { baseURL: string; defaultModel: string; keyEnv: string; modelEnv: string }> = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "qwen/qwen3.8-27b",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    keyEnv: "CEREBRAS_API_KEY",
    modelEnv: "CEREBRAS_MODEL",
  },
};

function activeProvider(): AIProvider {
  const p = process.env.AI_PROVIDER as AIProvider | undefined;
  return p && p in PROVIDERS ? p : "groq";
}

export function isAIConfigured(): boolean {
  const cfg = PROVIDERS[activeProvider()];
  return Boolean(process.env[cfg.keyEnv]);
}

/** Returns a configured client + model, or null when no key is set. */
export function getAI(): { client: OpenAI; model: string; provider: AIProvider } | null {
  const provider = activeProvider();
  const cfg = PROVIDERS[provider];
  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, baseURL: cfg.baseURL });
  const model = process.env[cfg.modelEnv] || cfg.defaultModel;
  return { client, model, provider };
}

/** Localized system prompt for the productivity copilot. */
export function systemPrompt(locale: Locale, extra?: string): string {
  const lang = locale === "fr" ? "French" : "English";
  return [
    "You are LifeOS, a warm, sharp AI productivity copilot living inside a personal operating system.",
    "You help the user run their projects, finances, goals and habits. Be concise and concrete — no filler.",
    `Always answer in ${lang}.`,
    "Prefer short paragraphs or tight bullet lists. Never exceed ~90 words unless asked.",
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
