"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStore, getUserKey } from "@/lib/db/store";
import { isMissingTable } from "@/lib/data/live";
import { CATEGORY_IDS, kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import { canonicalPair, sameLink } from "@/lib/brain/graph";
import type { DbBrainItem, DbBrainLink } from "@/lib/db/types";

/**
 * Every mutation of the second brain.
 *
 * Failures come back as a code the UI translates, never as raw database text
 * shown to the user. `migration_pending` is its own code because it is not a
 * bug: it means migration 007 hasn't been applied yet, and the UI says so.
 */
export type BrainErrorCode = "invalid" | "not_found" | "migration_pending" | "failed";
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
  origin: z.enum(["user", "suggested"]).default("user"),
});

/**
 * Connects two notes. Idempotent: linking notes that are already linked
 * returns the existing link rather than an error.
 *
 * Both notes must belong to the caller. Without that check a request carrying
 * a guessed UUID could attach a link to someone else's note — nothing could be
 * read through it, but it would sit in their graph and die with their note.
 */
export async function linkNotes(input: unknown): Promise<BrainResult<DbBrainLink>> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Invalid link.");
  const { a, b, reason, origin } = parsed.data;
  if (a.toLowerCase() === b.toLowerCase()) return fail("invalid", "A note cannot link to itself.");

  try {
    const store = getStore();
    const userKey = await getUserKey();

    const notes = await store.list(userKey, "brain");
    const mine = new Set(notes.map((n) => n.id.toLowerCase()));
    if (!mine.has(a.toLowerCase()) || !mine.has(b.toLowerCase())) {
      return fail("not_found", "One of these notes does not exist.");
    }

    const existing = (await store.list(userKey, "links")).find((l) => sameLink(l, a, b));
    if (existing) return done(existing);

    const [fromId, toId] = canonicalPair(a, b);
    const link = await store.insert(userKey, "links", {
      fromId,
      toId,
      reason: reason || null,
      origin,
    });
    refresh();
    return done(link);
  } catch (e) {
    return fromError(e);
  }
}

export async function unlinkNotes(linkId: unknown): Promise<BrainResult> {
  const pid = idSchema.safeParse(linkId);
  if (!pid.success) return fail("invalid", "Invalid link.");
  try {
    await getStore().remove(await getUserKey(), "links", pid.data);
    refresh();
    return done(null);
  } catch (e) {
    return fromError(e);
  }
}
