import { suggestLinks, type LinkLike, type NoteLike } from "./graph";
import { computeFocus, type FocusReason } from "./focus";
import { perspective, type Perspective, type RelationKind } from "./relations";

/**
 * What the assistant knows about you when it answers: built from your second
 * brain, for the question you just asked.
 *
 * Until this existed the assistant was a generic chatbot — it received the
 * conversation and nothing else, so "your AI that knows you" knew nothing.
 * Now every answer is grounded in what you wrote: your goals, what the focus
 * list says matters, and the notes most related to the question.
 *
 * Relevance uses the same explainable similarity as link suggestions — the
 * question is treated as a note and ranked against yours — so it needs no
 * embeddings service and behaves identically with or without an AI key.
 *
 * Bounded by `budget` characters. The Groq free tier rejects any request over
 * 7,000 input tokens (it answers 413), so an unbounded context would fail
 * exactly for the people who use the brain most.
 */

export interface ContextLabels {
  about: string;
  /** Line prefixes, punctuation included ("Name:" / "Nom :"). */
  name: string;
  work: string;
  areas: string;
  goals: string;
  focus: string;
  relevant: string;
  recent: string;
  empty: string;
  reason: (r: FocusReason) => string;
  /** A typed connection from one note's side: "moves forward", "supported by". */
  relation: (kind: RelationKind, side: Perspective) => string;
}

/** ~1,700 tokens: room for the system prompt, ten turns and the answer. */
export const DEFAULT_CONTEXT_BUDGET = 6_000;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Who the person is, from their profile. Areas arrive already worded. */
export interface PersonFacts {
  name?: string;
  profession?: string;
  areas: string[];
}

/** The "who they are" section, or null when the profile says nothing. */
export function aboutSection(
  p: PersonFacts | undefined,
  labels: Pick<ContextLabels, "about" | "name" | "work" | "areas">
): string | null {
  if (!p) return null;
  const lines = [
    p.name && `- ${labels.name} ${clip(p.name, 60)}`,
    p.profession && `- ${labels.work} ${clip(p.profession, 160)}`,
    p.areas.length > 0 && `- ${labels.areas} ${p.areas.join(", ")}`,
  ].filter(Boolean);
  return lines.length ? `## ${labels.about}\n${lines.join("\n")}` : null;
}

/** What the assistant receives, and which notes it was built from. */
export interface Grounding {
  text: string;
  /**
   * The notes most directly behind the answer — those matching the question
   * and the ones connected to them, or the focus list when nothing matched —
   * shown to the person as the answer's sources. Ids, most relevant first.
   */
  sources: string[];
}

/** Connections worth following first when expanding context. */
const KIND_ORDER: Record<RelationKind, number> = { advances: 0, supports: 1, tension: 2, extends: 3, related: 4 };

export function groundAnswer(input: {
  notes: NoteLike[];
  links: LinkLike[];
  question: string;
  now: Date;
  labels: ContextLabels;
  /** Who they are. First in the context, and never dropped for budget. */
  person?: PersonFacts;
  budget?: number;
}): Grounding {
  const { notes, links, question, now, labels, person, budget = DEFAULT_CONTEXT_BUDGET } = input;
  const about = aboutSection(person, labels);
  if (notes.length === 0) return { text: clip(about ? `${about}\n\n${labels.empty}` : labels.empty, budget), sources: [] };

  const byId = new Map(notes.map((n) => [n.id, n]));
  const sections: string[] = about ? [about] : [];
  const used = new Set<string>();

  const focus = computeFocus({ notes, links, now, limit: 5 });
  const focusReason = new Map(focus.map((f) => [f.id, f.reason]));

  // The question, ranked against the notes as if it were one of them. The id
  // cannot collide with a note: notes use uuids or "prefix_n" demo ids.
  const probe: NoteLike = { id: "#question", category: "thoughts", title: question, done: false, createdAt: now.toISOString() };
  const relevantIds = suggestLinks(probe, notes, [], 6).map((s) => s.id);

  // One hop along the connections of each relevant note: what a note is
  // connected to is often exactly what answers the question about it — the
  // fact behind a decision, the step behind a goal, the note it contradicts.
  const hops = new Map<string, { id: string; kind: RelationKind; side: Perspective; reason: string | null }[]>();
  for (const id of relevantIds) {
    const near = links
      .filter((l) => l.fromId === id || l.toId === id)
      .map((l) => {
        const kind = l.kind ?? "related";
        return {
          id: l.fromId === id ? l.toId : l.fromId,
          kind,
          side: perspective(kind, id, l.sourceId ?? null),
          reason: l.reason ?? null,
        };
      })
      .filter((h) => byId.has(h.id) && !relevantIds.includes(h.id))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id))
      .slice(0, 3);
    if (near.length) hops.set(id, near);
  }

  // Each note appears once, in its highest-priority section. A goal the focus
  // list flags ("no next step") keeps that reason inline instead of being
  // listed a second time under Focus.
  const goals = notes.filter((n) => n.category === "goals" && !n.done).slice(0, 8);
  if (goals.length) {
    const lines = goals.map((g) => {
      const r = focusReason.get(g.id);
      return r ? `- ${g.title} — ${labels.reason(r)}` : `- ${g.title}`;
    });
    sections.push(`## ${labels.goals}\n${lines.join("\n")}`);
    goals.forEach((g) => used.add(g.id));
  }

  const focusLines = focus
    .filter((f) => !used.has(f.id))
    .map((f) => {
      const n = byId.get(f.id);
      if (!n) return null;
      used.add(n.id);
      return `- ${n.title} — ${labels.reason(f.reason)}`;
    })
    .filter(Boolean);
  if (focusLines.length) sections.push(`## ${labels.focus}\n${focusLines.join("\n")}`);

  const relevant = relevantIds.map((id) => byId.get(id)).filter((n): n is NoteLike => !!n && !used.has(n.id));
  if (relevant.length) {
    const lines = relevant.map((n) => {
      used.add(n.id);
      const out = [`- ${n.title}`];
      const detail = (n.detail ?? "").trim();
      if (detail) out.push(`  ${clip(detail.replace(/\s+/g, " "), 280)}`);
      for (const h of hops.get(n.id) ?? []) {
        const other = byId.get(h.id);
        if (!other) continue;
        used.add(other.id);
        const why = h.reason ? ` — ${clip(h.reason, 120)}` : "";
        out.push(`  ↳ ${labels.relation(h.kind, h.side)}: ${other.title}${why}`);
      }
      return out.join("\n");
    });
    sections.push(`## ${labels.relevant}\n${lines.join("\n")}`);
  }

  // Recent *open* notes. Finished work is not current context; when it matters
  // to the question, the relevance pass above has already brought it in.
  const recent = [...notes]
    .filter((n) => !used.has(n.id) && !n.done)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  if (recent.length) sections.push(`## ${labels.recent}\n${recent.map((n) => `- ${n.title}`).join("\n")}`);

  // Sections are in priority order; drop from the end until it fits, then
  // hard-clip as a last resort. Goals and focus survive the longest.
  let text = sections.join("\n\n");
  while (text.length > budget && sections.length > 1) {
    sections.pop();
    text = sections.join("\n\n");
  }

  const sources: string[] = [];
  const add = (id: string) => {
    if (!sources.includes(id) && byId.has(id)) sources.push(id);
  };
  for (const id of relevantIds) {
    add(id);
    for (const h of hops.get(id) ?? []) add(h.id);
  }
  // The focus list stands in only when nothing matched the question: listed
  // next to real matches, unrelated steps read as if they had informed the answer.
  if (sources.length === 0) focus.forEach((f) => add(f.id));

  return { text: clip(text, budget), sources: sources.slice(0, 6) };
}

/** The context text alone. */
export function buildBrainContext(input: Parameters<typeof groundAnswer>[0]): string {
  return groundAnswer(input).text;
}
