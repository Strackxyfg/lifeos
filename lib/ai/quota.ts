/**
 * A per-person allowance for the calls that spend the operator's model budget
 * in bulk: transcribing a memo, splitting a dump.
 *
 * Being signed in is not enough of a limit. One account in a loop would spend
 * the day's Whisper quota (2 000 requests, shared by everyone) in minutes.
 * A sliding window per person and per kind of call stops that.
 *
 * Kept in memory, so on serverless each instance counts on its own: a person
 * whose requests land on two instances gets up to twice the allowance. That is
 * the right trade — it needs no store, and it still bounds a runaway loop,
 * which is what it is for.
 */

export interface Allowance {
  limit: number;
  windowMs: number;
}

export const ALLOWANCES = {
  transcribe: { limit: 30, windowMs: 60 * 60_000 },
  atomize: { limit: 40, windowMs: 60 * 60_000 },
  decide: { limit: 30, windowMs: 60 * 60_000 },
  // The double: reading notes for the portrait, and talking with it.
  portrait: { limit: 20, windowMs: 60 * 60_000 },
  double: { limit: 60, windowMs: 60 * 60_000 },
} as const satisfies Record<string, Allowance>;

export type QuotaKind = keyof typeof ALLOWANCES;

export interface Quota {
  /** Records a call if allowed; otherwise says when the next one will be. */
  take(who: string, kind: QuotaKind): { ok: true } | { ok: false; retryAfterMs: number };
}

export function createQuota(allowances: Record<QuotaKind, Allowance> = ALLOWANCES, now: () => number = Date.now): Quota {
  const calls = new Map<string, number[]>();
  return {
    take(who, kind) {
      const { limit, windowMs } = allowances[kind];
      const key = `${kind}:${who}`;
      const t = now();
      const recent = (calls.get(key) ?? []).filter((at) => at > t - windowMs);
      if (recent.length >= limit) {
        calls.set(key, recent);
        return { ok: false, retryAfterMs: recent[0] + windowMs - t };
      }
      recent.push(t);
      calls.set(key, recent);
      // Keep the map from growing with people who stopped calling.
      if (calls.size > 5_000) {
        for (const [k, v] of calls) if (!v.some((at) => at > t - windowMs)) calls.delete(k);
      }
      return { ok: true };
    },
  };
}

let shared: Quota | null = null;
export const quota = (): Quota => (shared ??= createQuota());
