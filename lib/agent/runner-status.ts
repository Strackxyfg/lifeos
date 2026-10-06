/**
 * Whether the agent on the server is running, from what LifeOS itself saw:
 * every call it makes with its token stamps the token's last use, and an
 * idle runner calls in every ten seconds (POLL_MS). Nothing is taken on the
 * runner's word.
 */

/** Three idle polls and a slow network: past this, the agent is not answering. */
export const ONLINE_WITHIN_S = 90;

export interface RunnerInfo {
  /** A token that has not been revoked exists. */
  tokenActive: boolean;
  /** When that token was last used (ISO), or null. */
  lastSeen: string | null;
}

export type RunnerState =
  /** No token: nothing can call in. */
  | "none"
  /** A token, never used: installed nowhere yet, or not started. */
  | "never"
  /** Called in within ONLINE_WITHIN_S. */
  | "online"
  /** Called in before, silent since: stopped, or its server is down. */
  | "offline";

export function runnerState(info: RunnerInfo, now = Date.now()): { state: RunnerState; secondsAgo: number | null } {
  if (!info.tokenActive) return { state: "none", secondsAgo: null };
  const seen = info.lastSeen ? Date.parse(info.lastSeen) : NaN;
  if (!Number.isFinite(seen)) return { state: "never", secondsAgo: null };
  const secondsAgo = Math.max(0, Math.round((now - seen) / 1000));
  return { state: secondsAgo <= ONLINE_WITHIN_S ? "online" : "offline", secondsAgo };
}

/**
 * The one command that installs (or updates) the agent on a server, for this
 * LifeOS. Nothing secret in it: the installer asks for the token on the
 * server, so it never sits in a shell's history or a process list.
 */
export function installCommand(origin: string, lang: "en" | "fr" = "en"): string {
  const url = `${origin.replace(/\/+$/, "")}/api/agent/runner/install.sh${lang === "fr" ? "?lang=fr" : ""}`;
  // Quoted: a `?` is a wildcard to the shell.
  return `curl -fsSL "${url}" | sudo bash`;
}

/** A server cannot reach these: LifeOS must be deployed (or tunnelled) first. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "[::1]" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return true;
  }
}
