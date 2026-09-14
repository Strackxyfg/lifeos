/**
 * Failure classification and backoff for the runner.
 *
 * Split out from index.mjs so it can be unit-tested: this is the logic that
 * decides whether a user's question gets retried or thrown away, and getting
 * it wrong is silent — you only find out when someone's message vanishes.
 *
 * The distinction that matters: a rate limit or a 5xx is the provider having a
 * moment and will pass. A bad key or a retired model will fail identically
 * forever. Retrying the first is correct; retrying the second is a loop.
 */

export function tag(err, retryable) {
  err.retryable = retryable;
  return err;
}

/**
 * Builds a diagnosable error from a failed model response.
 *
 * `readBody` is injected so this stays testable without a real Response.
 */
export async function classifyModelError(res, { model, base }) {
  const detail = await res.text().catch(() => "");
  const short = detail.slice(0, 200);

  if (res.status === 404) {
    return tag(
      new Error(
        `model "${model}" not found at ${base} (HTTP 404) — it may have been ` +
          `decommissioned by the provider. List current models: ` +
          `curl -H "Authorization: Bearer $MODEL_API_KEY" ${base}/models`
      ),
      false
    );
  }

  if (res.status === 401 || res.status === 403) {
    return tag(new Error(`model auth rejected (HTTP ${res.status}) — check MODEL_API_KEY. ${short}`), false);
  }

  if (res.status === 429) {
    // Providers say when to come back; honour it rather than guessing.
    const header = res.headers?.get?.("retry-after");
    const secs = header && /^\d+$/.test(String(header).trim()) ? Number(String(header).trim()) : null;
    const err = tag(
      new Error(`model rate-limited (HTTP 429)${secs ? ` — provider asked for ${secs}s` : ""}. ${short}`.trim()),
      true
    );
    if (secs) err.retryAfterMs = Math.min(secs * 1000, 10 * 60_000);
    return err;
  }

  // 5xx is the provider failing. Other 4xx is a malformed request, which will
  // be just as malformed next time.
  return tag(new Error(`model HTTP ${res.status} ${short}`.trim()), res.status >= 500);
}

/** A timeout or a dropped connection is worth retrying; a bug is not. */
export function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.retryable === true) return true;
  if (err.retryable === false) return false;
  const codes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"];
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    codes.includes(err.code) ||
    codes.includes(err.cause?.code)
  );
}

/**
 * Exponential backoff with jitter.
 *
 * The bug this replaces: the old error text said "backing off" while the loop
 * carried on at full speed 1.5 seconds later. A message that claims to wait
 * and doesn't is worse than no message.
 */
export function createBackoff({
  baseMs = 5_000,
  maxMs = 5 * 60_000,
  now = () => Date.now(),
  random = Math.random,
} = {}) {
  let until = 0;
  let failures = 0;

  return {
    enter(err) {
      failures += 1;
      const exponential = baseMs * 2 ** (failures - 1);
      // Jitter stops a fleet of runners retrying in lockstep.
      const jittered = exponential * (random() * 0.3 + 0.85);
      const wait = Math.min(err?.retryAfterMs ?? jittered, maxMs);
      until = now() + wait;
      return wait;
    },
    clear() {
      const recovered = failures > 0;
      failures = 0;
      until = 0;
      return recovered;
    },
    active: () => now() < until,
    remaining: () => Math.max(until - now(), 0),
    get failures() {
      return failures;
    },
  };
}
