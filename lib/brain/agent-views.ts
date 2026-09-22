import { CATEGORY_IDS, type BrainCategoryId } from "@/lib/data/brain";
import { degreeMap, pairKey, suggestLinks, type LinkLike, type NoteLike } from "./graph";
import { perspective, type Perspective, type RelationKind } from "./relations";
import { searchNotes } from "./search";

/**
 * The second brain as an agent reads it — through MCP, from Hermes or any
 * other client.
 *
 * `brain_read` used to answer "Read granted." and nothing else: the agent was
 * *allowed* to read the brain and was given no way to. These views are what it
 * actually receives.
 *
 * Compact on purpose. Agents pay per token and some providers reject large
 * requests outright (Groq's free tier answers 413 above 7,000 input tokens),
 * so the index lists titles and ids and points to `brain_search` for detail.
 * Ids are included because the agent needs them to connect notes.
 */

const REGION_NAME: Record<BrainCategoryId, string> = {
  goals: "Goals",
  next: "Next steps",
  ideas: "Ideas",
  thoughts: "Thoughts",
  knowledge: "Knowledge",
  insights: "Insights",
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A connection as an agent reads it, from one note's side. */
const RELATION_EN: Record<RelationKind, Record<Perspective, string>> = {
  advances: { out: "moves forward", in: "moved forward by", both: "moves forward" },
  supports: { out: "supports", in: "supported by", both: "supports" },
  extends: { out: "builds on", in: "developed in", both: "builds on" },
  tension: { out: "in tension with", in: "in tension with", both: "in tension with" },
  related: { out: "related to", in: "related to", both: "related to" },
};

/** "moves forward [id] "title" — reason" for each connection of `id`. */
function connectionsOf(id: string, notes: Map<string, NoteLike>, links: LinkLike[]): string[] {
  return links
    .filter((l) => l.fromId === id || l.toId === id)
    .map((l) => {
      const otherId = l.fromId === id ? l.toId : l.fromId;
      const other = notes.get(otherId);
      if (!other) return null;
      const kind = l.kind ?? "related";
      const review = l.origin === "ai" || l.origin === "agent" ? " (awaiting owner review)" : "";
      const why = l.reason ? ` — ${clip(oneLine(l.reason), 140)}` : "";
      return `${RELATION_EN[kind][perspective(kind, id, l.sourceId ?? null)]} [${otherId}] "${clip(oneLine(other.title), 70)}"${why}${review}`;
    })
    .filter((x): x is string => !!x);
}

export const INDEX_MAX_CHARS = 8_000;

/** Every open note by region, newest first; goals with their detail. */
export function brainIndex(notes: NoteLike[], links: LinkLike[], maxChars = INDEX_MAX_CHARS): string {
  if (notes.length === 0) return "The second brain is empty.";

  const degree = degreeMap(links);
  const open = notes.filter((n) => !n.done);
  const lines: string[] = [
    `${open.length} open notes, ${notes.length - open.length} done, ${links.length} connections.`,
    "Format: [id] title (· N links). Use brain_search for full text, brain_related for a note's connections, brain_link to connect two ids.",
  ];
  let shown = 0;

  outer: for (const region of CATEGORY_IDS) {
    const inRegion = open
      .filter((n) => n.category === region)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (inRegion.length === 0) continue;

    lines.push("", `## ${REGION_NAME[region]}`);
    for (const n of inRegion) {
      const d = degree.get(n.id) ?? 0;
      let line = `- [${n.id}] ${oneLine(n.title)}${d ? ` · ${d} link${d > 1 ? "s" : ""}` : ""}`;
      if (region === "goals" && n.detail) line += `\n  ${clip(oneLine(n.detail), 240)}`;

      if (lines.join("\n").length + line.length > maxChars) {
        lines.push(`… ${open.length - shown} more not shown — use brain_search.`);
        break outer;
      }
      lines.push(line);
      shown++;
    }
  }

  return lines.join("\n");
}

/** Full text of the notes matching a query, with what each is connected to. */
export function brainSearch(notes: NoteLike[], links: LinkLike[], query: string, limit = 10): string {
  const q = query.trim();
  if (!q) return "Give a query to search the second brain.";

  const hits = searchNotes(notes, q, limit);
  if (hits.length === 0) return `No note matches "${q}".`;

  const byId = new Map(notes.map((n) => [n.id, n]));
  return [
    `${hits.length} note${hits.length > 1 ? "s" : ""} matching "${q}":`,
    ...hits.map((n) => {
      const linked = connectionsOf(n.id, byId, links).slice(0, 6);
      return [
        "",
        `[${n.id}] ${oneLine(n.title)}  (${REGION_NAME[n.category]}${n.done ? ", done" : ""})`,
        n.detail ? clip(n.detail.trim(), 600) : null,
        linked.length ? `Connections:\n${linked.map((c) => `- ${c}`).join("\n")}` : null,
      ]
        .filter((x) => x !== null)
        .join("\n");
    }),
  ].join("\n");
}

/**
 * One note, what it is connected to and why, and the notes that look related
 * but are not connected yet — what an agent needs to decide on a connection
 * itself. Pairs the owner said are unrelated are never offered.
 */
export function brainRelated(
  notes: NoteLike[],
  links: LinkLike[],
  id: string,
  dismissed: ReadonlySet<string> = new Set()
): string {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const note = byId.get(id) ?? notes.find((n) => n.id.toLowerCase() === id.toLowerCase());
  if (!note) return `No note has the id "${id}". Use brain_search to find it.`;

  const connections = connectionsOf(note.id, byId, links);
  const candidates = suggestLinks(note, notes, links, 8, dismissed).filter((s) => !dismissed.has(pairKey(note.id, s.id)));
  return [
    `[${note.id}] ${oneLine(note.title)}  (${REGION_NAME[note.category]}${note.done ? ", done" : ""})`,
    note.detail ? clip(note.detail.trim(), 600) : null,
    note.concepts?.length ? `About: ${note.concepts.map((c) => c.k).join(", ")}` : null,
    "",
    connections.length ? `Connections:\n${connections.map((c) => `- ${c}`).join("\n")}` : "No connections yet.",
    "",
    candidates.length
      ? `Looks related, not connected (shared ${candidates[0].via}):\n${candidates
          .map((c) => {
            const o = byId.get(c.id);
            return o ? `- [${c.id}] "${clip(oneLine(o.title), 70)}" (${REGION_NAME[o.category]}) — shared: ${c.shared.slice(0, 3).join(", ")}` : null;
          })
          .filter(Boolean)
          .join("\n")}\nConnect with brain_link and a specific reason, or leave them.`
      : "Nothing else looks related.",
  ]
    .filter((x) => x !== null)
    .join("\n");
}
