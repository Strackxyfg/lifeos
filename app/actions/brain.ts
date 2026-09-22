"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStore, getUserKey } from "@/lib/db/store";
import { isMissingTable } from "@/lib/data/live";
import { CATEGORY_IDS, kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import { canonicalPair, pairKey, sameLink, toBrainLink, type BrainLink } from "@/lib/brain/graph";
import { RELATION_KINDS, isUnreviewed, sourceOf } from "@/lib/brain/relations";
import type { DbBrainItem } from "@/lib/db/types";

/**
 * Every mutation of the second brain.
 *
 * Failures come back as a code the UI translates, never as raw database text
 * shown to the user. `migration_pending` is its own code because it is not a
 * bug: it means migration 007 hasn't been applied yet, and the UI says so.
 */
export type BrainErrorCode =
  | "invalid"
  | "not_found"
  | "migration_pending"
  | "failed"
  /** No AI provider is configured. */
  | "unavailable"
  /** The model's rate limit was reached; retrying later works. */
  | "rate_limit";
export type BrainResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; code: BrainErrorCode; error: string };

const done = <T>(data: T): BrainResult<T> => ({ ok: true, data });
const fail = (code: BrainErrorCode, error: string): BrainResult<never> => ({ ok: false, code, error });

function fromError(e: unknown): BrainResult<never> {
  if (isMissingTable(e)) return fail("migration_pending", "Migration 007 has not been applied yet.");
  return fail("failed", e instanceof Error ? e.message : "Something went wrong.");
}

function refresh() {
  revalidatePath("/brain");
  revalidatePath("/dashboard");
}

const idSchema = z.string().trim().min(1).max(64);
const categorySchema = z.enum(CATEGORY_IDS as [BrainCategoryId, ...BrainCategoryId[]]);

/**
 * A note's text. 20 000 characters, not the old 500: knowledge notes are often
 * long, and the column is unbounded text — the limit only ever truncated people.
 */
const titleSchema = z.string().trim().min(1).max(500);
const detailSchema = z.string().trim().max(20_000).nullable().optional();

/* ── Notes ────────────────────────────────────────────────────────── */

const createSchema = z.object({
  title: titleSchema,
  detail: detailSchema,
  category: categorySchema,
  ai: z.boolean().default(false),
});

export async function createNote(input: unknown): Promise<BrainResult<DbBrainItem>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Invalid note.");
  const { title, detail, category, ai } = parsed.data;

  try {
    const note = await getStore().insert(await getUserKey(), "brain", {
      title,
      detail: detail || null,
      category,
      // The kind follows the region, so the two can never disagree.
      kind: kindForCategory[category],
      seedKey: null,
      done: false,
      ai,
    });
    refresh();
    return done(note);
  } catch (e) {
    return fromError(e);
  }
}

const patchSchema = z
  .object({
    title: titleSchema.optional(),
    detail: detailSchema,
    category: categorySchema.optional(),
    done: z.boolean().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), "Nothing to update.");

export async function updateNote(id: unknown, patch: unknown): Promise<BrainResult> {
  const pid = idSchema.safeParse(id);
  const pp = patchSchema.safeParse(patch);
  if (!pid.success || !pp.success) return fail("invalid", "Invalid update.");

  const { category, detail, ...rest } = pp.data;
  const update: Partial<DbBrainItem> = { ...rest };
  if (detail !== undefined) update.detail = detail || null;
  if (category) {
    update.category = category;
    update.kind = kindForCategory[category];
  }

  try {
    await getStore().update(await getUserKey(), "brain", pid.data, update);
    refresh();
    return done(null);
  } catch (e) {
    return fromError(e);
  }
}

/** Deletes a note. Its links go with it — the database cascades, the file store mirrors that. */
export async function deleteNote(id: unknown): Promise<BrainResult> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return fail("invalid", "Invalid note.");
  try {
    await getStore().remove(await getUserKey(), "brain", pid.data);
    refresh();
    return done(null);
  } catch (e) {
    return fromError(e);
  }
}

/* ── Links ────────────────────────────────────────────────────────── */

const linkSchema = z.object({
  a: idSchema,
  b: idSchema,
  reason: z.string().trim().max(300).nullable().optional(),
  // A person can draw a connection or accept a suggestion; only the engine
  // and the agent draw "ai" and "agent" ones.
  origin: z.enum(["user", "suggested"]).default("user"),
  kind: z.enum(RELATION_KINDS).default("related"),
});

/** Both notes, if both belong to the caller. */
async function ownPair(userKey: string, a: string, b: string): Promise<[DbBrainItem, DbBrainItem] | null> {
  const notes = await getStore().list(userKey, "brain");
  const find = (id: string) => notes.find((n) => n.id.toLowerCase() === id.toLowerCase());
  const A = find(a);
  const B = find(b);
  return A && B ? [A, B] : null;
}

/** Remembers that the person does not want these two notes connected. */
async function rememberNo(userKey: string, a: string, b: string): Promise<void> {
  const store = getStore();
  if (!(await store.supportsSynapses())) return;
  const key = pairKey(a, b);
  const existing = await store.list(userKey, "dismissals");
  if (existing.some((d) => pairKey(d.fromId, d.toId) === key)) return;
  const [fromId, toId] = canonicalPair(a, b);
  await store.insert(userKey, "dismissals", { fromId, toId });
}

/**
 * Connects two notes. Idempotent: linking notes that are already linked
 * returns the existing link rather than an error.
 *
 * Both notes must belong to the caller. Without that check a request carrying
 * a guessed UUID could attach a link to someone else's note — nothing could be
 * read through it, but it would sit in their graph and die with their note.
 */
export async function linkNotes(input: unknown): Promise<BrainResult<BrainLink>> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Invalid link.");
  const { a, b, reason, origin, kind } = parsed.data;
  if (a.toLowerCase() === b.toLowerCase()) return fail("invalid", "A note cannot link to itself.");

  try {
    const store = getStore();
    const userKey = await getUserKey();
    const pair = await ownPair(userKey, a, b);
    if (!pair) return fail("not_found", "One of these notes does not exist.");

    const existing = (await store.list(userKey, "links")).find((l) => sameLink(l, a, b));
    if (existing) return done(toBrainLink(existing));

    const [fromId, toId] = canonicalPair(a, b);
    const typed = await store.supportsSynapses();
    const link = await store.insert(userKey, "links", {
      fromId,
      toId,
      reason: reason || null,
      origin,
      // Before migration 008 there is nowhere to keep a kind: the connection
      // is stored plain and reads back as "related".
      ...(typed ? { kind, sourceId: sourceOf(kind, pair[0], pair[1]) } : {}),
    });
    refresh();
    return done(toBrainLink(link));
  } catch (e) {
    return fromError(e);
  }
}

/**
 * Removes a connection, and remembers the "no": otherwise the connection
 * engine would propose the same pair again at its next run.
 */
export async function unlinkNotes(linkId: unknown): Promise<BrainResult> {
  const pid = idSchema.safeParse(linkId);
  if (!pid.success) return fail("invalid", "Invalid link.");
  try {
    const store = getStore();
    const userKey = await getUserKey();
    const link = (await store.list(userKey, "links")).find((l) => l.id === pid.data);
    await store.remove(userKey, "links", pid.data);
    if (link) await rememberNo(userKey, link.fromId, link.toId);
    refresh();
    return done(null);
  } catch (e) {
    return fromError(e);
  }
}

/**
 * The person's answer to a connection the engine or the agent drew: keep it
 * (it becomes theirs — "suggested", accepted) or remove it (and never see
 * that pair proposed again).
 */
export async function reviewLink(linkId: unknown, decision: unknown): Promise<BrainResult> {
  const pid = idSchema.safeParse(linkId);
  const pd = z.enum(["keep", "remove"]).safeParse(decision);
  if (!pid.success || !pd.success) return fail("invalid", "Invalid review.");
  if (pd.data === "remove") return unlinkNotes(pid.data);
  try {
    await getStore().update(await getUserKey(), "links", pid.data, { origin: "suggested" });
    refresh();
    return done(null);
  } catch (e) {
    return fromError(e);
  }
}

/**
 * Changes what a connection means. Retyping an unreviewed connection counts
 * as reviewing it: the person has read it and decided what it is.
 */
export async function retypeLink(linkId: unknown, kind: unknown): Promise<BrainResult<BrainLink>> {
  const pid = idSchema.safeParse(linkId);
  const pk = z.enum(RELATION_KINDS).safeParse(kind);
  if (!pid.success || !pk.success) return fail("invalid", "Invalid relation.");
  try {
    const store = getStore();
    if (!(await store.supportsSynapses())) return fail("migration_pending", "Migration 008 has not been applied yet.");
    const userKey = await getUserKey();
    const link = (await store.list(userKey, "links")).find((l) => l.id === pid.data);
    if (!link) return fail("not_found", "That connection no longer exists.");
    const pair = await ownPair(userKey, link.fromId, link.toId);
    if (!pair) return fail("not_found", "One of these notes no longer exists.");

    const current = toBrainLink(link);
    // Keep the direction the connection already had when it still applies.
    const sourceId = sourceOf(pk.data, pair[0], pair[1], current.kind === pk.data ? current.sourceId : null);
    const origin = isUnreviewed(current.origin) ? "suggested" : current.origin;
    await store.update(userKey, "links", pid.data, { kind: pk.data, sourceId, origin });
    refresh();
    return done({ ...current, kind: pk.data, sourceId, origin });
  } catch (e) {
    return fromError(e);
  }
}

/** "These two are not related": hides a suggestion for good. */
export async function dismissPair(a: unknown, b: unknown): Promise<BrainResult> {
  const pa = idSchema.safeParse(a);
  const pb = idSchema.safeParse(b);
  if (!pa.success || !pb.success || pa.data.toLowerCase() === pb.data.toLowerCase()) return fail("invalid", "Invalid pair.");
  try {
    const store = getStore();
    if (!(await store.supportsSynapses())) return fail("migration_pending", "Migration 008 has not been applied yet.");
    const userKey = await getUserKey();
    if (!(await ownPair(userKey, pa.data, pb.data))) return fail("not_found", "One of these notes does not exist.");
    await rememberNo(userKey, pa.data, pb.data);
    return done(null);
  } catch (e) {
    return fromError(e);
  }
}
