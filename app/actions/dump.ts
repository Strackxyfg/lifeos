"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import { AIError, aiAvailable } from "@/lib/ai/router";
import { atomizeDump } from "@/lib/ai/brain-ai";
import { quota } from "@/lib/ai/quota";
import { ATOMIZE_LIMITS, splitDump, type AtomizeResult } from "@/lib/brain/atomize";
import { toBrainNotes } from "@/lib/brain/load";
import { canonicalPair, pairKey, toBrainLink, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { RELATION_KINDS, sourceOf } from "@/lib/brain/relations";
import { normalize } from "@/lib/brain/text";
import { CATEGORY_IDS, kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import type { DbBrainItem } from "@/lib/db/types";
import { getLocale, getMessages } from "@/lib/i18n/server";
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

const atomIndex = z.number().int().min(0).max(ATOMIZE_LIMITS.saved - 1);
const saveSchema = z
  .object({
    atoms: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(500),
          detail: z.string().trim().max(20_000).nullable().optional(),
          region: z.enum(CATEGORY_IDS as [BrainCategoryId, ...BrainCategoryId[]]),
        })
      )
      .min(1)
      .max(ATOMIZE_LIMITS.saved),
    relations: z
      .array(
        z.object({
          a: atomIndex,
          b: atomIndex,
          kind: z.enum(RELATION_KINDS),
          from: atomIndex.nullable(),
          reason: z.string().trim().max(300).optional().default(""),
        })
      )
      .max(60)
      .default([]),
  })
  .refine(
    (d) =>
      d.relations.every(
        (r) => r.a !== r.b && r.a < d.atoms.length && r.b < d.atoms.length && (r.from === null || r.from === r.a || r.from === r.b)
      ),
    "Invalid relation."
  );

/**
 * Saves the atoms the person kept, and the connections between them.
 *
 * The person has read and edited every note in the preview, so the notes are
 * theirs (`ai: false`) and the connections accepted (`suggested`). An atom
 * with the same words as an existing note is not written twice: the existing
 * note stands in for it, and the dump's connections attach to it — which is
 * how a new memo joins what the brain already holds.
 */
export async function saveBrainDump(input: unknown): Promise<BrainResult<{ notes: BrainNote[]; links: BrainLink[] }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Invalid notes.");
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("invalid", "Not signed in.");

  try {
    const store = getStore();
    const [items, m, typed] = await Promise.all([store.list(userKey, "brain"), getMessages(), store.supportsSynapses()]);
    // Seeded notes have no stored title — their text comes from the dictionary.
    const itemById = new Map(items.map((i) => [i.id, i]));
    const byTitle = new Map(
      toBrainNotes(items, m).flatMap((n) => {
        const item = itemById.get(n.id);
        return item ? [[normalize(n.title), item] as const] : [];
      })
    );

    const created: DbBrainItem[] = [];
    const slots: DbBrainItem[] = [];
    for (const atom of parsed.data.atoms) {
      const key = normalize(atom.title);
      const same = byTitle.get(key);
      if (same) {
        slots.push(same);
        continue;
      }
      const note = await store.insert(userKey, "brain", {
        title: atom.title,
        detail: atom.detail || null,
        category: atom.region,
        kind: kindForCategory[atom.region],
        seedKey: null,
        done: false,
        ai: false,
      });
      byTitle.set(key, note);
      created.push(note);
      slots.push(note);
    }

    const links: BrainLink[] = [];
    if (parsed.data.relations.length > 0) {
      const existing = await store.list(userKey, "links").catch((err: unknown) => {
        // No links table yet (migration 007): the notes are still worth having.
        if (isMissingTable(err)) return null;
        throw err;
      });
      if (existing) {
        const have = new Set(existing.map((l) => pairKey(l.fromId, l.toId)));
        for (const r of parsed.data.relations) {
          const A = slots[r.a];
          const B = slots[r.b];
          if (A.id === B.id || have.has(pairKey(A.id, B.id))) continue;
          have.add(pairKey(A.id, B.id));
          const [fromId, toId] = canonicalPair(A.id, B.id);
          const explicit = r.from === null ? null : slots[r.from].id;
          const link = await store.insert(userKey, "links", {
            fromId,
            toId,
            reason: r.reason || null,
            origin: "suggested",
            ...(typed ? { kind: r.kind, sourceId: sourceOf(r.kind, A, B, explicit) } : {}),
          });
          links.push(toBrainLink(link));
        }
      }
    }

    revalidatePath("/brain");
    revalidatePath("/dashboard");
    return { ok: true, data: { notes: toBrainNotes(created, m), links } };
  } catch (err) {
    console.error("[dump] save failed", err);
    return fail("failed", "Could not save the notes.");
  }
}
