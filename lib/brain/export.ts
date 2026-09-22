import { canonicalPair, type BrainNote, type LinkLike } from "./graph";
import { perspective, type Perspective, type RelationKind } from "./relations";
import type { Concept } from "./concepts";
import { CATEGORY_IDS, type BrainCategoryId, type BrainItemKind } from "@/lib/data/brain";

/**
 * Your whole second brain, in open formats.
 *
 * This is what makes "sovereign" more than a word: if you leave LifeOS
 * tomorrow, everything leaves with you, links included, in formats other tools
 * already read. Markdown opens in any editor and is Obsidian-compatible —
 * links become `[[wikilinks]]` and resolve there. JSON keeps every field for
 * a lossless re-import.
 */

export type ExportNote = BrainNote;

export interface ExportLink extends LinkLike {
  createdAt?: string;
}

export const EXPORT_FORMAT = "lifeos.brain";
export const EXPORT_VERSION = 1;

/** Region order, then oldest first, then id: stable across exports. */
function ordered<N extends ExportNote>(notes: N[]): N[] {
  const rank = (c: BrainCategoryId) => CATEGORY_IDS.indexOf(c);
  return [...notes].sort(
    (a, b) =>
      rank(a.category) - rank(b.category) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  );
}

/**
 * Characters Obsidian cannot hold in a link target. A title containing them
 * would produce a link that silently points nowhere.
 */
export function wikiSafe(title: string): string {
  return title.replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

/**
 * One display title per note, unique within the export. Two notes both called
 * "Idées" would make `[[Idées]]` ambiguous, so later duplicates get " (2)",
 * " (3)"… — in the heading and in every link that points at them.
 */
export function uniqueTitles(notes: ExportNote[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Map<string, number>();
  for (const n of ordered(notes)) {
    const base = wikiSafe(n.title);
    const key = base.toLowerCase();
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    out.set(n.id, count === 1 ? base : `${base} (${count})`);
  }
  return out;
}

export interface MarkdownLabels {
  title: string;
  exportedOn: string;
  /** The summary line's counts, pluralised by the caller's language rules. */
  counts: (notes: number, links: number) => string;
  region: Record<BrainCategoryId, string>;
  /**
   * The lead-in before a note's links, punctuation included: "Connections:"
   * in English, "Connexions :" in French, where a space precedes the colon.
   */
  linkedTo: string;
  done: string;
  todo: string;
  /**
   * What a typed connection means from this note's side ("moves forward",
   * "supported by"). Plain "related" connections are listed without it.
   */
  relation?: (kind: RelationKind, side: Perspective) => string;
}

export function toMarkdown(
  notes: ExportNote[],
  links: ExportLink[],
  labels: MarkdownLabels,
  exportedAt: Date
): string {
  const titles = uniqueTitles(notes);
  const lines: string[] = [];

  lines.push(
    "---",
    `lifeos_export: ${EXPORT_VERSION}`,
    `exported_at: ${exportedAt.toISOString()}`,
    `notes: ${notes.length}`,
    `links: ${links.length}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `> ${labels.exportedOn} ${exportedAt.toISOString().slice(0, 10)} · ${labels.counts(notes.length, links.length)}`,
    ""
  );

  for (const region of CATEGORY_IDS) {
    const inRegion = ordered(notes.filter((n) => n.category === region));
    if (inRegion.length === 0) continue;

    lines.push(`## ${labels.region[region]}`, "");

    for (const n of inRegion) {
      lines.push(`### ${titles.get(n.id)}`, "");

      if (n.category === "next") {
        lines.push(`- [${n.done ? "x" : " "}] ${n.done ? labels.done : labels.todo}`, "");
      }

      const detail = (n.detail ?? "").trim();
      if (detail) lines.push(detail, "");

      const linked = links
        .filter((l) => l.fromId === n.id || l.toId === n.id)
        .map((l) => {
          const title = titles.get(l.fromId === n.id ? l.toId : l.fromId);
          if (!title) return null;
          const kind = l.kind ?? "related";
          const note = kind !== "related" && labels.relation
            ? ` (${labels.relation(kind, perspective(kind, n.id, l.sourceId ?? null))})`
            : "";
          return { title, text: `[[${title}]]${note}` };
        })
        .filter((x): x is { title: string; text: string } => !!x)
        .sort((a, b) => a.title.localeCompare(b.title));
      if (linked.length > 0) {
        lines.push(`${labels.linkedTo} ${linked.map((x) => x.text).join(" · ")}`, "");
      }

      // Invisible when rendered; lets a future import match notes by identity
      // rather than by title.
      lines.push(`<!-- lifeos id=${n.id} created=${n.createdAt}${n.ai ? " ai=1" : ""} -->`, "");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export interface JsonExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  notes: {
    id: string;
    category: BrainCategoryId;
    kind: BrainItemKind;
    title: string;
    detail: string | null;
    done: boolean;
    ai: boolean;
    createdAt: string;
    /** Added in the same format version: readers of version 1 ignore it. */
    concepts: Concept[];
  }[];
  links: {
    fromId: string;
    toId: string;
    reason: string | null;
    origin: string | null;
    createdAt: string | null;
    kind: RelationKind;
    /** The note a directed relation starts from, or null. */
    sourceId: string | null;
  }[];
}

export function toJson(notes: ExportNote[], links: ExportLink[], exportedAt: Date): JsonExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    notes: ordered(notes).map((n) => ({
      id: n.id,
      category: n.category,
      kind: n.kind,
      title: n.title,
      detail: n.detail ?? null,
      done: n.done,
      ai: n.ai,
      createdAt: n.createdAt,
      concepts: n.concepts ?? [],
    })),
    links: [...links]
      .map((l) => {
        const [fromId, toId] = canonicalPair(l.fromId, l.toId);
        return {
          fromId,
          toId,
          reason: l.reason ?? null,
          origin: l.origin ?? null,
          createdAt: l.createdAt ?? null,
          kind: l.kind ?? "related",
          sourceId: l.sourceId ?? null,
        };
      })
      .sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId)),
  };
}
