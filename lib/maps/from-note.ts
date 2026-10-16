import type { LinkLike, NoteLike } from "@/lib/brain/graph";
import { perspective, type Perspective, type RelationKind } from "@/lib/brain/relations";
import type { Outline } from "./model";

/**
 * A note of the second brain as a map: the note in the middle, its
 * connections around it grouped by what they mean ("supported by",
 * "moves forward", "in tension with"…), and, one step further, what those
 * notes connect to. Every idea on it links back to its note.
 *
 * Deterministic, no model: the brain's own connections, drawn as a tree.
 */

const KIND_EMOJI: Record<RelationKind, string> = {
  advances: "🎯",
  supports: "🧱",
  extends: "🌱",
  tension: "⚖️",
  related: "🔗",
};

const ORDER: RelationKind[] = ["advances", "supports", "extends", "tension", "related"];
const MAX_PER_GROUP = 12;
const MAX_SECOND = 5;
const MAX_NODES = 90;

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function outlineFromNote(
  noteId: string,
  notes: NoteLike[],
  links: LinkLike[],
  label: (kind: RelationKind, side: Perspective) => string
): Outline | null {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const note = byId.get(noteId);
  if (!note) return null;
  let budget = MAX_NODES - 1;

  const neighbours = (id: string) =>
    links
      .filter((l) => (l.fromId === id || l.toId === id) && byId.has(l.fromId === id ? l.toId : l.fromId))
      .map((l) => {
        const other = l.fromId === id ? l.toId : l.fromId;
        const kind: RelationKind = l.kind ?? "related";
        return { other, kind, side: perspective(kind, id, l.sourceId ?? null) };
      });

  const asIdea = (n: NoteLike): Outline => {
    const o: Outline = { text: clip(n.title, 300), noteId: n.id };
    const detail = clip(n.detail, 2000);
    if (detail) o.note = detail;
    return o;
  };

  const root: Outline = asIdea(note);
  const shown = new Set([noteId]);
  const groups = new Map<string, { kind: RelationKind; side: Perspective; ids: string[] }>();
  for (const nb of neighbours(noteId)) {
    const key = `${nb.kind}:${nb.side}`;
    const g = groups.get(key) ?? { kind: nb.kind, side: nb.side, ids: [] };
    if (!g.ids.includes(nb.other)) g.ids.push(nb.other);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.side.localeCompare(b.side));
  const children: Outline[] = [];
  for (const g of sorted) {
    if (budget <= 1) break;
    budget--;
    const group: Outline = { text: label(g.kind, g.side), emoji: KIND_EMOJI[g.kind], children: [] };
    for (const id of g.ids.slice(0, MAX_PER_GROUP)) {
      if (budget <= 0 || shown.has(id)) continue;
      budget--;
      shown.add(id);
      group.children!.push(asIdea(byId.get(id)!));
    }
    if (group.children!.length) children.push(group);
  }
  // One step further: what each connected note connects to, not already shown.
  for (const group of children) {
    for (const idea of group.children ?? []) {
      const more = neighbours(idea.noteId!).filter((nb) => !shown.has(nb.other)).slice(0, MAX_SECOND);
      for (const nb of more) {
        if (budget <= 0) break;
        budget--;
        shown.add(nb.other);
        (idea.children ??= []).push(asIdea(byId.get(nb.other)!));
      }
      if (idea.children?.length) idea.collapsed = true;
    }
  }
  if (children.length) root.children = children;
  return root;
}
