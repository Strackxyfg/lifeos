import "server-only";
import { getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import { getAI } from "@/lib/ai/client";
import { BrainAIError, extractConcepts, judgePairs } from "@/lib/ai/brain-ai";
import { contentHash, type Concept } from "./concepts";
import { canonicalPair, pairKey, toBrainLink, type BrainLink, type BrainNote } from "./graph";
import { toBrainNotes } from "./load";
import { AUTO_LINK, planLinks, rankPairs } from "./weave";
import type { DbBrainItem } from "@/lib/db/types";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/dictionaries";

/**
 * Runs the connection engine for one person: analyse the notes that need it,
 * pick the pairs worth asking about, let the model judge them, and draw the
 * connections it is confident about — marked for the person's review.
 *
 * Two modes. Focused (`focusIds`): around notes just captured, cheap enough to
 * run on every capture. Whole brain: the "organise my brain" button, which
 * also catches up on notes never analysed.
 *
 * It never throws for an expected reason. No model, a pending migration, a
 * rate limit: each comes back as `stopped`, with whatever was already done
 * kept — the next run resumes, because analysed notes carry their hash and
 * drawn connections are not proposed again.
 */

export interface WeaveReport {
  /** False when no AI provider is configured: nothing was attempted. */
  ai: boolean;
  /** Notes whose concepts were read in this run. */
  analysed: number;
  /** The concepts read in this run, by note id — so the screen can show them at once. */
  concepts: Record<string, Concept[]>;
  /** Pairs the model judged. */
  judged: number;
  created: BrainLink[];
  stopped: null | "migration_pending" | "rate_limit" | "failed";
}

/**
 * Sized to a free-tier provider's per-minute token quota (about 6,000 on
 * Groq's): a capture costs roughly 2,500 tokens, so two captures a minute
 * stay under it; "organise" costs about 5,000 and is meant to be pressed
 * once, not in a loop. Whatever does not fit in a run is picked up by the
 * next — notes keep their analysis, and drawn connections are not re-asked.
 */
const BUDGET = {
  focused: { analyse: 6, pairs: 8, total: 4 },
  whole: { analyse: 20, pairs: 16, total: AUTO_LINK.total },
} as const;

export async function weave(
  userKey: string,
  opts: { focusIds?: string[]; locale: Locale; m: Messages }
): Promise<WeaveReport> {
  const report: WeaveReport = { ai: true, analysed: 0, concepts: {}, judged: 0, created: [], stopped: null };
  if (!getAI()) return { ...report, ai: false };

  const store = getStore();
  if (!(await store.supportsSynapses())) return { ...report, stopped: "migration_pending" };

  const focused = !!opts.focusIds?.length;
  const budget = focused ? BUDGET.focused : BUDGET.whole;

  let items: DbBrainItem[];
  let links: BrainLink[];
  let dismissed: Set<string>;
  try {
    const [rawItems, rawLinks, rawDismissals] = await Promise.all([
      store.list(userKey, "brain"),
      store.list(userKey, "links"),
      store.list(userKey, "dismissals"),
    ]);
    items = rawItems;
    links = rawLinks.map(toBrainLink);
    dismissed = new Set(rawDismissals.map((d) => pairKey(d.fromId, d.toId)));
  } catch (err) {
    if (isMissingTable(err)) return { ...report, stopped: "migration_pending" };
    throw err;
  }

  const notes = toBrainNotes(items, opts.m);
  const byId = new Map<string, BrainNote>(notes.map((n) => [n.id, n]));
  const hashOf = new Map(items.map((i) => [i.id, i.conceptsHash ?? null]));
  const focusIds = (opts.focusIds ?? []).filter((id) => byId.has(id));
  if (focused && focusIds.length === 0) return report;

  try {
    // 1 — Understand. Focused notes first (the point of the run), then the
    // most recent open notes: they are the likeliest candidates, and each run
    // catches up a little on notes never analysed.
    // Every focused note is analysed, whatever the budget — one call covers up
    // to twenty — and goals go first: they are what everything else connects to.
    const stale = notes.filter((n) => hashOf.get(n.id) !== contentHash(n.title, n.detail));
    const goalsFirst = (a: BrainNote, b: BrainNote) =>
      Number(b.category === "goals") - Number(a.category === "goals") || b.createdAt.localeCompare(a.createdAt);
    const order = [
      ...stale.filter((n) => focusIds.includes(n.id)).sort(goalsFirst),
      ...stale.filter((n) => !focusIds.includes(n.id) && !n.done).sort(goalsFirst),
    ].slice(0, Math.min(20, Math.max(budget.analyse, focusIds.length)));

    // The vocabulary this brain already uses, most frequent first, so a new
    // note about the same subject gets the same key.
    const freq = new Map<string, number>();
    for (const n of notes) for (const c of n.concepts) freq.set(c.k, (freq.get(c.k) ?? 0) + 1);
    const known = () =>
      [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);

    for (let i = 0; i < order.length; i += 20) {
      const batch = order.slice(i, i + 20);
      const found = await extractConcepts(batch, known());
      for (const cs of found.values()) for (const c of cs) freq.set(c.k, (freq.get(c.k) ?? 0) + 1);
      for (const [id, concepts] of found) {
        const note = byId.get(id);
        if (!note) continue;
        await store.update(userKey, "brain", id, { concepts, conceptsHash: contentHash(note.title, note.detail) });
        note.concepts = concepts;
        report.concepts[id] = concepts;
        report.analysed++;
      }
    }

    // 2 — Choose the pairs worth a model's attention.
    const pairs = rankPairs({
      notes,
      links,
      dismissed,
      focusIds: focused ? focusIds : undefined,
      limit: budget.pairs,
    });
    if (pairs.length === 0) return report;

    // 3 — Judge, then keep only what the model is confident about.
    const verdicts = await judgePairs(pairs, byId, opts.locale);
    report.judged = pairs.length;
    const plan = planLinks(pairs, verdicts, notes, { ...AUTO_LINK, total: budget.total });

    // 4 — Draw. Re-read first: another run (a second capture a second later)
    // may have drawn the same pair meanwhile.
    const existing = new Set((await store.list(userKey, "links")).map((l) => pairKey(l.fromId, l.toId)));
    for (const p of plan) {
      const key = pairKey(p.a, p.b);
      if (existing.has(key)) continue;
      const [fromId, toId] = canonicalPair(p.a, p.b);
      try {
        const row = await store.insert(userKey, "links", {
          fromId,
          toId,
          reason: p.reason,
          origin: "ai",
          kind: p.kind,
          sourceId: p.sourceId,
        });
        existing.add(key);
        report.created.push(toBrainLink(row));
      } catch (err) {
        // The unique index lost a race with a concurrent run: already drawn.
        if (!/23505|duplicate key/i.test(err instanceof Error ? err.message : String(err))) throw err;
      }
    }
    return report;
  } catch (err) {
    if (err instanceof BrainAIError) {
      return { ...report, stopped: err.code === "rate_limit" ? "rate_limit" : err.code === "unavailable" ? null : "failed", ai: err.code !== "unavailable" };
    }
    console.error("[weave] failed", err);
    return { ...report, stopped: "failed" };
  }
}
