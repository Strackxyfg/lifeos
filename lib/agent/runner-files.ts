import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The runner's own files, served by LifeOS so a server can install the agent
 * from the LifeOS it will talk to — one command, no git clone, no repository
 * to make public, and an update is the same command again.
 *
 * Public on purpose: these are the runner's source and its installer, the
 * same for everyone, with no secret and no data in them. Only the names
 * below are served (no path from the request ever reaches the disk), and
 * the installer gets the address of this LifeOS written in, so it does not
 * have to ask for it.
 */

/** Served name → file in `agent-runner/`. Keep in step with the Dockerfile's COPY and install.sh's RUNNER_FILES. */
export const RUNNER_FILES = {
  "install.sh": "install.sh",
  "index.mjs": "index.mjs",
  "retry.mjs": "retry.mjs",
  Dockerfile: "Dockerfile",
  "docker-compose.yml": "docker-compose.yml",
} as const;

export type RunnerFile = keyof typeof RUNNER_FILES;

export function isRunnerFile(name: string): name is RunnerFile {
  return Object.prototype.hasOwnProperty.call(RUNNER_FILES, name);
}

/** What install.sh carries until it is served: the address it installs against, and the language it speaks. */
export const URL_PLACEHOLDER = "__LIFEOS_URL__";
export const LANG_PLACEHOLDER = "__LIFEOS_LANG__";

/**
 * The address a server reaches this LifeOS at: the one the request came to —
 * the server fetching the installer just reached LifeOS there, so it works
 * from that server, whatever NEXT_PUBLIC_APP_URL says — else the configured
 * public URL. Only an http(s) origin, nothing else.
 */
export function originFrom(
  headers: { get(name: string): string | null },
  fallbackUrl: string | null,
  configured = process.env.NEXT_PUBLIC_APP_URL
): string | null {
  // A URL parser lets `$`, quotes and parentheses through in a host name; in
  // the installer they would be shell syntax. Letters, digits, dots and
  // hyphens (or a bracketed IPv6 address), and a port: nothing else is written in.
  const SAFE = /^https?:\/\/(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
  const pick = (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      return SAFE.test(u.origin) ? u.origin : null;
    } catch {
      return null;
    }
  };
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (fallbackUrl ? new URL(fallbackUrl).protocol.replace(":", "") : "https");
  return pick(host ? `${proto}://${host}` : null) ?? pick(configured) ?? pick(fallbackUrl);
}

export function publicOrigin(req: Request): string {
  return originFrom(req.headers, req.url) ?? new URL(req.url).origin;
}

/**
 * Writes the address (and the language, `en` or `fr` only) into the
 * installer; leaves every other file as it is.
 */
export function prepare(name: RunnerFile, source: string, origin: string, lang?: string | null): string {
  if (name !== "install.sh") return source;
  // The origin is a parsed URL's origin: no quote, no space, no `$` can be in it.
  const withUrl = source.split(URL_PLACEHOLDER).join(origin);
  return lang === "en" || lang === "fr" ? withUrl.split(LANG_PLACEHOLDER).join(lang) : withUrl;
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Reads one runner file from the deployment (traced into the server bundle:
 * next.config.mjs), with Unix line ends whatever the checkout has: a shell
 * script with Windows line ends fails on its first line on a Linux server.
 */
export async function readRunnerFile(name: RunnerFile): Promise<string> {
  const text = await readFile(path.join(process.cwd(), "agent-runner", RUNNER_FILES[name]), "utf8");
  return text.replace(/\r\n/g, "\n");
}

/** Every file but the installer, with its SHA-256, for the installer to check what it downloaded. */
export async function manifest(): Promise<{ files: Record<string, string> }> {
  const files: Record<string, string> = {};
  for (const name of Object.keys(RUNNER_FILES) as RunnerFile[]) {
    if (name === "install.sh") continue;
    files[name] = sha256(await readRunnerFile(name));
  }
  return { files };
}
