import { domainToASCII } from "node:url";

/**
 * Proving a company owns an email domain: a DNS record only the domain's
 * owner can publish. The claim holds a random token; the record carries it.
 *
 *   _lifeos-challenge.acme.com  TXT  "lifeos-domain-verification=<token>"
 *
 * A record under its own name, not at the apex: it is found without
 * reading the domain's other TXT records, and removing it later touches
 * nothing else.
 */

export const CHALLENGE_LABEL = "_lifeos-challenge";
export const CHALLENGE_PREFIX = "lifeos-domain-verification=";

/**
 * Mailbox providers anyone can sign up to. Owning an address there proves
 * nothing about a company, so none of them can be claimed.
 */
export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "hotmail.be", "hotmail.co.uk",
  "live.com", "live.fr", "live.be", "msn.com", "yahoo.com", "yahoo.fr", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com",
  "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "gmx.fr", "gmx.net", "web.de",
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr", "neuf.fr", "bbox.fr", "skynet.be", "telenet.be",
  "proximus.be", "voo.be", "bluewin.ch", "libero.it", "yandex.ru", "yandex.com", "mail.ru", "zoho.com", "fastmail.com",
  "hey.com", "tutanota.com", "tuta.io", "qq.com", "163.com", "126.com", "naver.com",
]);

export type DomainProblem = "invalid" | "public";

/**
 * A domain as typed ("https://www.Acme.com/", "@acme.com", "Café.fr") → its
 * canonical ASCII form ("www.acme.com", "acme.com", "xn--caf-dma.fr"), or
 * why it cannot be claimed.
 */
export function normalizeDomain(input: string): { ok: true; domain: string } | { ok: false; problem: DomainProblem } {
  let v = input.trim().toLowerCase();
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // a scheme
  v = v.replace(/^[^@/]*@/, ""); // an address: keep what follows the @
  v = v.replace(/[/?#].*$/, ""); // a path
  v = v.replace(/:\d+$/, ""); // a port
  v = v.replace(/\.$/, ""); // the root dot
  if (!v || v.length > 253) return { ok: false, problem: "invalid" };
  const ascii = domainToASCII(v);
  if (!ascii) return { ok: false, problem: "invalid" };
  const labels = ascii.split(".");
  if (labels.length < 2) return { ok: false, problem: "invalid" };
  const label = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!labels.every((l) => label.test(l))) return { ok: false, problem: "invalid" };
  // The last label is a name, never a number: 10.0.0.1 is an address.
  if (!/^[a-z]/.test(labels[labels.length - 1])) return { ok: false, problem: "invalid" };
  if (PUBLIC_MAIL_DOMAINS.has(ascii)) return { ok: false, problem: "public" };
  return { ok: true, domain: ascii };
}

export function challengeName(domain: string): string {
  return `${CHALLENGE_LABEL}.${domain}`;
}

export function challengeValue(token: string): string {
  return `${CHALLENGE_PREFIX}${token}`;
}

export type TxtResolver = (name: string) => Promise<string[][]>;

export type DomainCheck = { state: "verified" } | { state: "missing"; seen: number } | { state: "error"; code: string };

/**
 * Reads the challenge record. "missing" says how many TXT records were found
 * at the name (none at all usually means it has not propagated yet); a DNS
 * failure other than "no such record" is an error, not a verdict.
 */
export async function checkDomain(domain: string, token: string, resolveTxt?: TxtResolver): Promise<DomainCheck> {
  const resolve = resolveTxt ?? (await import("node:dns")).promises.resolveTxt;
  let records: string[][];
  try {
    records = await resolve(challengeName(domain));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "EUNKNOWN";
    if (code === "ENOTFOUND" || code === "ENODATA") return { state: "missing", seen: 0 };
    return { state: "error", code };
  }
  // A TXT record may arrive split in 255-byte strings: joined, it is one value.
  const want = challengeValue(token);
  const found = records.some((chunks) => chunks.join("").trim() === want);
  return found ? { state: "verified" } : { state: "missing", seen: records.length };
}

/** The domain of an email address, lower-cased — or null. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}
