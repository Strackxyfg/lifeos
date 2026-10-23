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

/** Every address the person wrote or a tool returned in this conversation. */
export function knownUrls(messages: AgentMessage[]): Set<string> {
  const known = new Set<string>();
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "tool") continue;
    for (const match of m.content.matchAll(URL_IN_TEXT)) {
      const n = normalizeUrl(match[0]);
      if (n) known.add(n);
    }
  }
  return known;
}

export function isKnownUrl(url: unknown, messages: AgentMessage[]): boolean {
  if (typeof url !== "string") return false;
  const n = normalizeUrl(url);
  return n !== null && knownUrls(messages).has(n);
}
