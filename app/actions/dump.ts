"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { AIError, aiAvailable } from "@/lib/ai/router";
import { atomizeDump } from "@/lib/ai/brain-ai";
import { quota } from "@/lib/ai/quota";
import { splitDump, type AtomizeResult } from "@/lib/brain/atomize";
import { toBrainNotes } from "@/lib/brain/load";
import type { BrainLink, BrainNote } from "@/lib/brain/graph";
import { normalize } from "@/lib/brain/text";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { atomsSchema, saveAtoms } from "@/lib/brain/save-atoms";
import type { BrainResult } from "./brain";

/**
 * A brain dump — a voice memo's transcript or pasted notes — turned into
 * atomic notes, in two steps the person sees: split (nothing is saved), then
 * save what they kept.
 *
 * Both use the strict key: splitting spends the operator's model budget, and
 * saving writes into a brain that must be the caller's own.
 */

const fail = (code: "invalid" | "failed", error: string) => ({ ok: false, code, error }) as const;

export interface DumpSplit extends AtomizeResult {
  /** Who split it: the model, or the line-and-sentence rules. */
  by: "ai" | "rules";
  /** Why the rules were used, when the model was not. */
  fallback: null | "unavailable" | "rate_limit" | "failed";
  /** For each atom, the existing note with the same words, if there is one. */
  existing: (string | null)[];
}

const dumpText = z.string().trim().min(1).max(20_000);

export async function splitBrainDump(text: unknown): Promise<BrainResult<DumpSplit>> {
  const parsed = dumpText.safeParse(text);
  if (!parsed.success) return fail("invalid", "Nothing to split.");
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("invalid", "Not signed in.");

  try {
    const [items, m, locale] = await Promise.all([getStore().list(userKey, "brain"), getMessages(), getLocale()]);
    const notes = toBrainNotes(items, m);

    let result: AtomizeResult | null = null;
    let fallback: DumpSplit["fallback"] = null;
    if (!aiAvailable()) fallback = "unavailable";
    else if (!quota().take(userKey, "atomize").ok) fallback = "rate_limit";
    else {
      try {
        const split = await atomizeDump({
          text: parsed.data,
          goals: notes.filter((n) => n.category === "goals" && !n.done),
          locale,
        });
        if (split.atoms.length > 0) result = split;
        else fallback = "failed";
      } catch (err) {
        fallback = err instanceof AIError && err.code === "rate_limit" ? "rate_limit" : "failed";
        if (!(err instanceof AIError)) console.error("[dump] split failed", err);
      }
    }
    const split = result ?? splitDump(parsed.data);

    const known = new Map(notes.map((n) => [normalize(n.title), n.id]));
    return {
      ok: true,
      data: {
        ...split,
        by: result ? "ai" : "rules",
        fallback: result ? null : fallback,
        existing: split.atoms.map((a) => known.get(normalize(a.title)) ?? null),
      },
    };
  } catch (err) {
    console.error("[dump] split failed", err);
    return fail("failed", "Could not split the dump.");
  }
}

/** Saves the atoms the person kept — see `saveAtoms`. A dump with its recording is saved by `/api/brain/voice-note`. */
export async function saveBrainDump(input: unknown): Promise<BrainResult<{ notes: BrainNote[]; links: BrainLink[] }>> {
  const parsed = atomsSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Invalid notes.");
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("invalid", "Not signed in.");

  try {
    const saved = await saveAtoms(getStore(), userKey, parsed.data, await getMessages());
    revalidatePath("/brain");
    revalidatePath("/dashboard");
    return { ok: true, data: saved };
  } catch (err) {
    console.error("[dump] save failed", err);
    return fail("failed", "Could not save the notes.");
  }
}
