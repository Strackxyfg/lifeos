import { normalize } from "./text";
import type { NoteLike } from "./graph";

/**
 * Find notes by what's in them.
 *
 * Substring matching on normalised text rather than the tokeniser used for
 * link suggestions: people type part of a word into a search box and expect
 * it to match ("linke" → "LinkedIn"), and they type short words like "IA" that
 * a tokeniser would discard. Every term must match (AND), in any order,
 * accent-insensitively.
 */
export function searchNotes<N extends NoteLike>(notes: N[], query: string, limit = 30): N[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: { note: N; score: number }[] = [];
  for (const note of notes) {
    const title = normalize(note.title);
    const body = normalize(note.detail ?? "");

    let score = 0;
    let all = true;
    for (const t of terms) {
      if (title.includes(t)) score += title.startsWith(t) ? 3 : 2;
      else if (body.includes(t)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ note, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.note.createdAt.localeCompare(a.note.createdAt) ||
        a.note.id.localeCompare(b.note.id)
    )
    .slice(0, limit)
    .map((s) => s.note);
}
