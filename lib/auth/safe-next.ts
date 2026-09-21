/**
 * Where to send someone after they sign in, from a `?next=` parameter.
 *
 * Only a path on this site is accepted. Anything else — `https://evil.com`,
 * the protocol-relative `//evil.com`, `/\evil.com` (which some browsers read
 * as `//`), or a `javascript:` URL — falls back to the default. Without this,
 * `/login?next=https://evil.com` sent people to a lookalike site the instant
 * after they had typed their password: an open redirect, and a phishing kit's
 * favourite tool.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  const v = next.trim();

  if (!v.startsWith("/")) return fallback; // absolute URLs, javascript:, relative paths
  if (v.startsWith("//") || v.startsWith("/\\")) return fallback; // protocol-relative
  if (/[\u0000-\u001f]/.test(v)) return fallback; // control chars hide tricks like "/\t/evil.com"

  // Belt and braces: resolve it and insist it stays on the same origin.
  try {
    const base = "https://lifeos.invalid";
    const url = new URL(v, base);
    if (url.origin !== base) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
