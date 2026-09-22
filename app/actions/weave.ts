"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import { getAI } from "@/lib/ai/client";
import { BrainAIError, proposeSteps } from "@/lib/ai/brain-ai";
import { weave, type WeaveReport } from "@/lib/brain/weaver";
import { toBrainNotes } from "@/lib/brain/load";
import { canonicalPair, neighborsOf, toBrainLink, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { normalize } from "@/lib/brain/text";
import { kindForCategory } from "@/lib/data/brain";
import { getLocale, getMessages } from "@/lib/i18n/server";
import type { BrainResult } from "./brain";

/**
 * The second brain's intelligence, as actions: weave connections, and turn a
 * note into next steps.
 *
 * All of them use the strict key. They spend the operator's model budget, and
 * the demo fallback would let a signed-out visitor spend it — and write into
 * the shared demo brain.
 */

const done = <T>(data: T): BrainResult<T> => ({ ok: true, data });
const fail = (code: "invalid" | "not_found" | "unavailable" | "rate_limit" | "failed", error: string) =>
  ({ ok: false, code, error }) as const;

export type WeaveResult = Omit<WeaveReport, "created"> & { created: BrainLink[] };

const idsSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(20);

async function run(focusIds?: string[]): Promise<BrainResult<WeaveResult>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("invalid", "Not signed in.");
  const [locale, m] = await Promise.all([getLocale(), getMessages()]);
  const report = await weave(userKey, { focusIds, locale, m });
  if (report.created.length > 0) revalidatePath("/brain");
  return done(report);
}

/** Connects notes just written — run after every capture. */
export async function weaveNotes(ids: unknown): Promise<BrainResult<WeaveResult>> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return fail("invalid", "Invalid notes.");
  return run(parsed.data);
}

/** "Organise my brain": catches up on unanalysed notes and connects across the whole brain. */
export async function weaveBrain(): Promise<BrainResult<WeaveResult>> {
  return run();
}

/* ── From a note to action ────────────────────────────────────────── */

const noteId = z.string().trim().min(1).max(64);

/** Next steps the model proposes for a note, grounded in what it is connected to. */
export async function proposeNextSteps(id: unknown): Promise<BrainResult<string[]>> {
  const pid = noteId.safeParse(id);
  if (!pid.success) return fail("invalid", "Invalid note.");
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("invalid", "Not signed in.");
  if (!getAI()) return fail("unavailable", "No AI provider is configured.");

  try {
    const store = getStore();
    const [items, links, locale, m] = await Promise.all([
      store.list(userKey, "brain"),
      store.list(userKey, "links").catch(() => []),
      getLocale(),
      getMessages(),
    ]);
    const notes = toBrainNotes(items, m);
    const note = notes.find((n) => n.id === pid.data);
    if (!note) return fail("not_found", "That note no longer exists.");

    const near = neighborsOf(note.id, links);
    const related = notes.filter((n) => near.has(n.id));
    const steps = await proposeSteps({
      note,
      related,
      existingSteps: related.filter((n) => n.category === "next" && !n.done),
      goals: notes.filter((n) => n.category === "goals" && !n.done && n.id !== note.id),
      locale,
    });
    return done(steps);
  } catch (err) {
    if (err instanceof BrainAIError) {
      return fail(err.code === "rate_limit" ? "rate_limit" : err.code === "unavailable" ? "unavailable" : "failed", err.message);
    }
    console.error("[steps] failed", err);
    return fail("failed", "Could not propose steps.");
  }
}

const adoptSchema = z.object({
  id: noteId,
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
});

/**
 * Adds the steps the person kept, each as a next step connected to the note
 * it moves forward. Accepted by the person, so the connections are theirs
 * ("suggested"), not awaiting review.
 */
export async function adoptNextSteps(input: unknown): Promise<BrainResult<{ notes: BrainNote[]; links: BrainLink[] }>> {
  const parsed = adoptSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Invalid steps.");
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("invalid", "Not signed in.");

  try {
    const store = getStore();
    const [items, m, typed] = await Promise.all([store.list(userKey, "brain"), getMessages(), store.supportsSynapses()]);
    const target = items.find((i) => i.id === parsed.data.id);
    if (!target) return fail("not_found", "That note no longer exists.");

    // A step that already exists (same words, any case or accent) is not added twice.
    const titles = new Set(toBrainNotes(items, m).map((n) => normalize(n.title)));
    const notes: BrainNote[] = [];
    const links: BrainLink[] = [];
    for (const title of parsed.data.steps) {
      if (titles.has(normalize(title))) continue;
      titles.add(normalize(title));
      const created = await store.insert(userKey, "brain", {
        title,
        detail: null,
        category: "next",
        kind: kindForCategory.next,
        seedKey: null,
        done: false,
        ai: false,
      });
      notes.push(...toBrainNotes([created], m));
      const [fromId, toId] = canonicalPair(created.id, target.id);
      const link = await store
        .insert(userKey, "links", {
          fromId,
          toId,
          reason: null,
          origin: "suggested",
          ...(typed ? { kind: "advances" as const, sourceId: created.id.toLowerCase() } : {}),
        })
        .catch((err: unknown) => {
          // No links table yet (migration 007): the steps are still worth having.
          if (isMissingTable(err)) return null;
          throw err;
        });
      if (link) links.push(toBrainLink(link));
    }
    revalidatePath("/brain");
    return done({ notes, links });
  } catch (err) {
    console.error("[steps] adopt failed", err);
    return fail("failed", "Could not add the steps.");
  }
}
