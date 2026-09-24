import "server-only";
import { z } from "zod";
import { isMissingTable } from "@/lib/db/errors";
import type { DbBrainItem, Store } from "@/lib/db/types";
import { ATOMIZE_LIMITS } from "./atomize";
import { toBrainNotes } from "./load";
import { canonicalPair, pairKey, toBrainLink, type BrainLink, type BrainNote } from "./graph";
import { RELATION_KINDS, sourceOf } from "./relations";
import { normalize } from "./text";
import { CATEGORY_IDS, kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import { locateQuote, type AudioWord } from "@/lib/voice/align";
import type { Messages } from "@/lib/i18n/dictionaries";

const atomIndex = z.number().int().min(0).max(ATOMIZE_LIMITS.saved - 1);

/** The notes kept from a dump, as the client sends them. */
export const atomsSchema = z
  .object({
    atoms: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(500),
          detail: z.string().trim().max(20_000).nullable().optional(),
          region: z.enum(CATEGORY_IDS as [BrainCategoryId, ...BrainCategoryId[]]),
          /** The words of the dump this note comes from — to find its passage in a recording. */
          said: z.string().trim().max(600).optional(),
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

export type AtomsInput = z.infer<typeof atomsSchema>;

/**
 * Saves the atoms the person kept, and the connections between them.
 *
 * The person has read and edited every note in the preview, so the notes are
 * theirs (`ai: false`) and the connections accepted (`suggested`). An atom
 * with the same words as an existing note is not written twice: the existing
 * note stands in for it, and the dump's connections attach to it — which is
 * how a new memo joins what the brain already holds.
 *
 * With a recording, each new note points to it, at the passage its quote was
 * found in; a note whose quote cannot be placed plays the whole recording.
 */
export async function saveAtoms(
  store: Store,
  userKey: string,
  input: AtomsInput,
  m: Messages,
  recording?: { id: string; words: AudioWord[] } | null
): Promise<{ notes: BrainNote[]; links: BrainLink[] }> {
  const [items, typed] = await Promise.all([store.list(userKey, "brain"), store.supportsSynapses()]);
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
  for (const atom of input.atoms) {
    const key = normalize(atom.title);
    const same = byTitle.get(key);
    if (same) {
      slots.push(same);
      continue;
    }
    const passage = recording && atom.said ? locateQuote(recording.words, atom.said) : null;
    const note = await store.insert(userKey, "brain", {
      title: atom.title,
      detail: atom.detail || null,
      category: atom.region,
      kind: kindForCategory[atom.region],
      seedKey: null,
      done: false,
      ai: false,
      ...(recording
        ? {
            audioId: recording.id,
            audioStartMs: passage ? passage.start : null,
            audioEndMs: passage ? Math.max(passage.end, passage.start + 1) : null,
          }
        : {}),
    });
    byTitle.set(key, note);
    created.push(note);
    slots.push(note);
  }

  const links: BrainLink[] = [];
  if (input.relations.length > 0) {
    const existing = await store.list(userKey, "links").catch((err: unknown) => {
      // No links table yet (migration 007): the notes are still worth having.
      if (isMissingTable(err)) return null;
      throw err;
    });
    if (existing) {
      const have = new Set(existing.map((l) => pairKey(l.fromId, l.toId)));
      for (const r of input.relations) {
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
  return { notes: toBrainNotes(created, m), links };
}
