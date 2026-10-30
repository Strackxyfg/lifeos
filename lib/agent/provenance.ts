import type { AgentMessage } from "@/lib/ai/types";

/**
 * Where a web address came from.
 *
 * Reading a page means sending a request to its site, and a model can put
 * anything in an address it writes itself — including what it read in the
 * person's notes. So the agent reads freely only the addresses the
 * conversation already holds: written by the person, or found in what a
 * tool returned (search results, the links of a page already read, a
 * sub-agent's report). An address the model composed itself waits for the
 * owner's approval, which shows it in full.
 */

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/gi;

/** An address in a comparable form: no fragment, no trailing punctuation or slash, host in lower case. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[.,;:!?]+$/, "");
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  const href = u.href;
  return href.endsWith("/") && u.pathname !== "/" ? href.slice(0, -1) : href.replace(/\/$/, "");
}

/** Tools whose results come from the web itself, not from a model's pen. */
const FROM_THE_WEB = new Set(["web_search", "web_read"]);
export const SOURCES_OPEN = "<<<SOURCES CONSULTED>>>";
export const SOURCES_CLOSE = "<<<END OF SOURCES>>>";

/**
 * Every address the person wrote or the web returned in this conversation.
 * Text a model wrote — its answers, a sub-agent's report, a program's
 * output — could carry an address it composed, so it does not count; of a
 * research report, only the list of pages its sub-agents actually opened,
 * written by LifeOS between the markers, does.
 */
export function knownUrls(messages: AgentMessage[]): Set<string> {
  const known = new Set<string>();
  const take = (text: string) => {
    for (const match of text.matchAll(URL_IN_TEXT)) {
      const n = normalizeUrl(match[0]);
      if (n) known.add(n);
    }
  };
  for (const m of messages) {
    if (m.role === "user") take(m.content);
    else if (m.role === "tool" && !m.isError) {
      if (FROM_THE_WEB.has(m.name)) take(m.content);
      else if (m.name === "research") {
        const start = m.content.indexOf(SOURCES_OPEN);
        const end = m.content.indexOf(SOURCES_CLOSE);
        if (start >= 0 && end > start) take(m.content.slice(start, end));
      }
    }
  }
  return known;
}

export function isKnownUrl(url: unknown, messages: AgentMessage[]): boolean {
  if (typeof url !== "string") return false;
  const n = normalizeUrl(url);
  return n !== null && knownUrls(messages).has(n);
}
