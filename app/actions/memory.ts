"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore, getUserKey } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import { AIError, aiAvailable } from "@/lib/ai/router";
import { proposeDecisions } from "@/lib/ai/brain-ai";
import { quota } from "@/lib/ai/quota";
import { toBrainNotes } from "@/lib/brain/load";
import { canonicalPair, neighborsOf, toBrainLink, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { schedule, type Scheduled } from "@/lib/brain/review";
import { dayKey } from "@/lib/brain/resurface";
import type { DecisionOption } from "@/lib/brain/decide";
import { CATEGORY_IDS, kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import { getLocale, getMessages } from "@/lib/i18n/server";
import type { BrainErrorCode, BrainResult } from "./brain";

/**
 * The brain's memory, as actions: answering a review, and deciding a
 * tension. Failures come back as codes the UI translates.
 */

const fail = (code: BrainErrorCode, error: string): BrainResult<never> => ({ ok: false, code, error });
const idSchema = z.string().trim().min(1).max(64);

function refresh() {
  revalidatePath("/brain");
  revalidatePath("/dashboard");
}

/* ── Spaced review ────────────────────────────────────────────────── */

/**
 * The person's answer to a review: the note still holds (it comes back later),
 * needs rework (it comes back in two days), or no longer holds (archived).
 * Archiving works before migration 009 — it only marks the note done; the
 * other two need somewhere to keep the schedule.
 */
export async function reviewNote(id: unknown, answer: unknown): Promise<BrainResult<Scheduled>> {
  const pid = idSchema.safeParse(id);
  const pa = z.enum(["keep", "rework", "archive"]).safeParse(answer);
  if (!pid.success || !pa.success) return fail("invalid", "Invalid review.");
  try {
    const store = getStore();
    const userKey = await getUserKey();
    const [items, memory] = await Promise.all([store.list(userKey, "brain"), store.supportsMemory()]);
    const item = items.find((i) => i.id === pid.data);
    if (!item) return fail("not_found", "That note no longer exists.");

    const now = new Date();
    const next = schedule(
      { ...item, title: item.title ?? "", category: item.category, reviewDue: item.reviewDue ?? null },
      pa.data,
      dayKey(now),
      now.toISOString()
    );
    if (!memory) {
      if (pa.data !== "archive") return fail("migration_pending", "Migration 009 has not been applied yet.");
      await store.update(userKey, "brain", item.id, { done: true });
    } else {
      await store.update(userKey, "brain", item.id, {
        reviewDue: next.reviewDue,
        reviewInterval: next.reviewInterval,
        reviewedAt: next.reviewedAt,
        ...(next.done ? { done: true } : {}),
      });
    }
    refresh();
    return { ok: true, data: next };
  } catch (e) {
    return fail("failed", e instanceof Error ? e.message : "Could not save the review.");
  }
}

/* ── From a tension to a decision ─────────────────────────────────── */

async function tensionOf(userKey: string, linkId: string) {
  const store = getStore();
  const [items, links, m] = await Promise.all([store.list(userKey, "brain"), store.list(userKey, "links"), getMessages()]);
  const link = links.find((l) => l.id === linkId);
  if (!link || (link.kind ?? "related") !== "tension") return null;
  const notes = toBrainNotes(items, m);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const a = byId.get(link.fromId);
  const b = byId.get(link.toId);
  return a && b ? { link, a, b, notes, links, byId } : null;
}

/** Decisions the model proposes for a tension, from the two notes and what surrounds them. */
export async function proposeDecisionOptions(linkId: unknown): Promise<BrainResult<DecisionOption[]>> {
  const pid = idSchema.safeParse(linkId);
  if (!pid.success) return fail("invalid", "Invalid tension.");
  // Strict key: this spends the operator's model budget.
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("invalid", "Not signed in.");
  if (!aiAvailable()) return fail("unavailable", "No AI provider is configured.");
  const allowed = quota().take(userKey, "decide");
  if (!allowed.ok) return fail("rate_limit", "Too many requests.");

  try {
    const t = await tensionOf(userKey, pid.data);
    if (!t) return fail("not_found", "That tension no longer exists.");
    const connected = (id: string, other: string) =>
      [...neighborsOf(id, t.links)].filter((n) => n !== other).map((n) => t.byId.get(n)).filter((n): n is BrainNote => !!n);
    const options = await proposeDecisions({
      a: t.a,
      b: t.b,
      reason: t.link.reason ?? null,
      aConnected: connected(t.a.id, t.b.id),
      bConnected: connected(t.b.id, t.a.id),
      goals: t.notes.filter((n) => n.category === "goals" && !n.done && n.id !== t.a.id && n.id !== t.b.id),
      locale: await getLocale(),
    });
    return { ok: true, data: options };
  } catch (err) {
    if (err instanceof AIError) {
      return fail(err.code === "rate_limit" ? "rate_limit" : err.code === "unavailable" ? "unavailable" : "failed", err.message);
    }
    console.error("[decide] options failed", err);
    return fail("failed", "Could not propose decisions.");
  }
}

const decisionSchema = z.object({
  linkId: idSchema,
  title: z.string().trim().min(3).max(500),
  why: z.string().trim().max(2_000).optional().default(""),
  region: z.enum(CATEGORY_IDS as [BrainCategoryId, ...BrainCategoryId[]]).default("insights"),
  /** Sides the person sets aside with this decision: marked done, not deleted. */
  archive: z.array(idSchema).max(2).default([]),
});

/**
 * Records a decision: a note of its own, in the person's words, connected to
 * both sides ("builds on" each), and — once migration 009 is applied —
 * marked as what resolved the tension. Before it, the decision and its
 * connections are still saved; the tension simply stays listed.
 */
export async function recordDecision(
  input: unknown
): Promise<BrainResult<{ note: BrainNote; links: BrainLink[]; tension: BrainLink; archived: string[] }>> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Invalid decision.");
  try {
    const store = getStore();
    const userKey = await getUserKey();
    const t = await tensionOf(userKey, parsed.data.linkId);
    if (!t) return fail("not_found", "That tension no longer exists.");
    const [typed, memory] = await Promise.all([store.supportsSynapses(), store.supportsMemory()]);
    const { title, why, region } = parsed.data;

    const created = await store.insert(userKey, "brain", {
      title,
      detail: why || null,
      category: region,
      kind: kindForCategory[region],
      seedKey: null,
      done: false,
      ai: false,
    });

    const links: BrainLink[] = [];
    for (const side of [t.a, t.b]) {
      const [fromId, toId] = canonicalPair(created.id, side.id);
      const link = await store.insert(userKey, "links", {
        fromId,
        toId,
        reason: null,
        origin: "user",
        ...(typed ? { kind: "extends" as const, sourceId: created.id.toLowerCase() } : {}),
      });
      links.push(toBrainLink(link));
    }

    if (memory) await store.update(userKey, "links", t.link.id, { resolvedBy: created.id });
    const archived = parsed.data.archive.filter((id) => id === t.a.id || id === t.b.id);
    for (const id of archived) await store.update(userKey, "brain", id, { done: true });

    refresh();
    const m = await getMessages();
    return {
      ok: true,
      data: {
        note: toBrainNotes([created], m)[0],
        links,
        tension: toBrainLink({ ...t.link, resolvedBy: memory ? created.id : null }),
        archived,
      },
    };
  } catch (e) {
    if (isMissingTable(e)) return fail("migration_pending", "Migration 007 has not been applied yet.");
    return fail("failed", e instanceof Error ? e.message : "Could not record the decision.");
  }
}
