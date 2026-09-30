import "server-only";
import type { Store, DbTrait, DbCheckin, DbAdviceState } from "@/lib/db/types";
import { isMissingTable } from "@/lib/db/errors";
import { afterNoteChange, isDimension, sanitizeEvidence, type TraitLike } from "./portrait";
import type { CheckinLike } from "./rhythm";
import type { AdviceState } from "./advice";

/**
 * The double's data, read and kept true.
 *
 * Tolerant of migration 015 not having run: the double then has nothing,
 * and says why (`available: false`). Any other failure is thrown — a
 * portrait that silently comes back empty would look like a person the
 * double knows nothing about.
 */

export interface SelfData {
  available: boolean;
  traits: TraitLike[];
  checkins: (CheckinLike & { id: string; at: string; questionId: string | null; noteId: string | null })[];
  advice: AdviceState[];
}

const EMPTY: SelfData = { available: false, traits: [], checkins: [], advice: [] };

/** A stored trait, validated on the way out like any other input. */
export function toTrait(row: DbTrait): TraitLike | null {
  if (!isDimension(row.dimension)) return null;
  const status = row.status === "confirmed" || row.status === "rejected" ? row.status : "proposed";
  return {
    id: row.id,
    dimension: row.dimension,
    statement: String(row.statement ?? "").slice(0, 240),
    evidence: sanitizeEvidence(row.evidence),
    status,
    origin: row.origin === "person" ? "person" : "ai",
    key: String(row.key ?? ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  };
}

export function toCheckin(row: DbCheckin): SelfData["checkins"][number] {
  const scale = (v: unknown) => (typeof v === "number" && v >= 1 && v <= 5 ? Math.round(v) : null);
  return {
    id: row.id,
    at: row.at,
    // Postgres dates come back as "YYYY-MM-DD"; keep exactly that.
    day: String(row.day).slice(0, 10),
    hour: typeof row.hour === "number" ? row.hour : 12,
    mood: scale(row.mood),
    energy: scale(row.energy),
    questionId: row.questionId ?? null,
    noteId: row.noteId ?? null,
  };
}

export async function loadSelfData(store: Store, userKey: string): Promise<SelfData> {
  try {
    if (!(await store.supportsSelf())) return EMPTY;
    const [traits, checkins, advice] = await Promise.all([
      store.list(userKey, "traits"),
      store.list(userKey, "checkins"),
      store.list(userKey, "advice"),
    ]);
    return {
      available: true,
      traits: traits.map(toTrait).filter((t): t is TraitLike => t !== null),
      checkins: checkins.map(toCheckin).sort((a, b) => a.at.localeCompare(b.at)),
      advice: advice.map((a: DbAdviceState) => ({ adviceKey: a.adviceKey, status: a.status, until: a.until ?? null })),
    };
  } catch (err) {
    if (isMissingTable(err)) return EMPTY;
    throw err;
  }
}

/**
 * A note was deleted (`newText` null) or rewritten: the quotes taken from it
 * that it no longer holds leave the portrait, and a proposal left with none
 * goes (`afterNoteChange`). Never fails the note's own change: a portrait
 * lagging by one note is repaired at the next change; a note that cannot be
 * deleted is worse.
 */
export async function reconcilePortrait(store: Store, userKey: string, noteId: string, newText: string | null): Promise<void> {
  try {
    if (!(await store.supportsSelf())) return;
    const traits = (await store.list(userKey, "traits")).map(toTrait).filter((t): t is TraitLike => t !== null);
    const { update, remove } = afterNoteChange(traits, noteId, newText);
    const now = new Date().toISOString();
    for (const u of update) await store.update(userKey, "traits", u.id, { evidence: u.evidence, updatedAt: now });
    for (const id of remove) await store.remove(userKey, "traits", id);
  } catch (err) {
    console.error("[self] portrait not reconciled after a note change", err);
  }
}
