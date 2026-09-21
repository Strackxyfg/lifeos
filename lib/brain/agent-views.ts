import { CATEGORY_IDS, type BrainCategoryId } from "@/lib/data/brain";
import { degreeMap, neighborsOf, type LinkLike, type NoteLike } from "./graph";
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

export const INDEX_MAX_CHARS = 8_000;

/** Every open note by region, newest first; goals with their detail. */
export function brainIndex(notes: NoteLike[], links: LinkLike[], maxChars = INDEX_MAX_CHARS): string {
  if (notes.length === 0) return "The second brain is empty.";

  const degree = degreeMap(links);
  const open = notes.filter((n) => !n.done);
  const lines: string[] = [
    `${open.length} open notes, ${notes.length - open.length} done, ${links.length} connections.`,
    "Format: [id] title (· N links). Use brain_search for full text, brain_link to connect two ids.",
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
      const linked = [...neighborsOf(n.id, links)]
        .map((id) => byId.get(id)?.title)
        .filter((t): t is string => !!t)
        .map((t) => `"${clip(oneLine(t), 60)}"`);
      return [
        "",
        `[${n.id}] ${oneLine(n.title)}  (${REGION_NAME[n.category]}${n.done ? ", done" : ""})`,
        n.detail ? clip(n.detail.trim(), 600) : null,
        linked.length ? `Connected to: ${linked.join(", ")}` : null,
      ]
        .filter((x) => x !== null)
        .join("\n");
    }),
  ].join("\n");
}
