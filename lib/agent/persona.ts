import "server-only";
import type { Store } from "@/lib/db/types";
import { isMissingTable } from "@/lib/db/errors";
import { toBrainNotes } from "@/lib/brain/load";
import { liveLinks, toBrainLink, type BrainLink } from "@/lib/brain/graph";
import { computeFocus } from "@/lib/brain/focus";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { loadSelfData } from "@/lib/self/store";
import { portraitOf } from "@/lib/self/portrait";
import { portraitSection, rhythmSection } from "@/lib/self/double";
import { localDayHour, summarize } from "@/lib/self/rhythm";
import { registerOf, selfGender } from "@/lib/self/voice";
import { careOf, type Care } from "@/lib/self/care";

/**
 * The agent is the person's double at work: it knows them from the inside —
 * the portrait they confirmed, their goals and what deserves their
 * attention now, how they work best, the way they write — and everything it
 * does is fitted to them. This is what it is told about them, built on
 * every request from their own data, bounded so it never crowds out the work.
 *
 * And, as the double does, it listens for what is heavy: a message that
 * may mean the person is in danger puts their safety before any task.
 */

export interface Persona {
  /** The section of the system prompt about them. */
  text: string;
  care: Care;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const line = (s: string) => s.replace(/\s+/g, " ").trim();

export async function personaFor(input: {
  store: Store;
  userKey: string;
  locale: Locale;
  zone: string;
  now: Date;
  person: { name?: string; profession?: string; areas: string[] };
  /** What they wrote in this conversation, oldest first. */
  userMessages: string[];
}): Promise<Persona> {
  const { store, userKey, locale, zone, now, person, userMessages } = input;
  const notes = toBrainNotes(await store.list(userKey, "brain").catch(() => []), dictionaries[locale]);
  let links: BrainLink[] = [];
  try {
    links = liveLinks((await store.list(userKey, "links")).map(toBrainLink), notes);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const self = await loadSelfData(store, userKey).catch(() => null);

  const sections: string[] = [];
  sections.push(
    [
      "## Who you work for — you are their double at work",
      "You know them from the inside, through their own notes and the portrait they confirmed. Fit everything to them: their goals,",
      "what matters to them, how they work best. When you write for them — an email, a message, a post — write the way they write.",
      "Use what you know of them when it helps the task; never recite it, never invent anything about them.",
      [person.name ? `Name: ${person.name}.` : null, person.profession ? `Work: ${person.profession}.` : null, person.areas.length ? `Wants help with: ${person.areas.join(", ")}.` : null]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join("\n")
  );

  const goals = notes.filter((n) => n.category === "goals" && !n.done).slice(0, 6);
  if (goals.length) sections.push(`## Their goals\n${goals.map((g) => `- "${clip(line(g.title), 140)}"`).join("\n")}`);

  const titles = new Map(notes.map((n) => [n.id, n.title]));
  const focus = computeFocus({ notes, links, now, limit: 3 })
    .map((f) => titles.get(f.id))
    .filter((t): t is string => Boolean(t));
  if (focus.length) sections.push(`## What deserves their attention now\n${focus.map((t) => `- "${clip(line(t), 140)}"`).join("\n")}`);

  if (self?.available) {
    if (self.traits.some((t) => t.status !== "rejected")) sections.push(portraitSection(portraitOf(self.traits, notes), 1_400));
    const { day } = localDayHour(now, zone);
    const rhythm = rhythmSection(self.checkins.length ? summarize(self.checkins, day) : null);
    if (rhythm) sections.push(rhythm);
  }

  if (locale === "fr") {
    const own = notes.filter((n) => !n.ai).map((n) => `${n.title} ${n.detail ?? ""}`);
    const gender = selfGender([...userMessages, ...own]);
    const register = registerOf(userMessages);
    sections.push(
      [
        "## How they write to you",
        `- They address you with "${register}": answer with "${register}".`,
        gender === "m"
          ? "- They speak of themselves in the masculine: agree with them the same way."
          : gender === "f"
            ? "- They speak of themselves in the feminine: agree with them the same way."
            : '- You do not know their gender: never make an adjective or a participle agree with them; turn the sentence instead ("vous avez besoin de repos", not "vous êtes fatigué"). Never inclusive forms ("·e", "(e)").',
      ].join("\n")
    );
  }

  const care = careOf(userMessages.slice(-3));
  if (care === "crisis") {
    sections.push(
      [
        "## Their safety comes first",
        "What they just wrote may mean they are thinking of ending their life or hurting themselves. Before any task: tell them you are",
        "glad they told you, ask whether they are safe right now, and ask them to reach someone now —",
        locale === "fr"
          ? "le 3114 (gratuit, 24 h/24, en France), le 15 ou le 112 en cas de danger, ou une personne de confiance."
          : "988 in the US and Canada, Samaritans on 116 123 in the UK and Ireland, the local emergency number if they are in danger, or a person they trust.",
        "Short, warm, plain; no tools unless they ask; stay with them.",
      ].join("\n")
    );
  } else if (care === "distress") {
    sections.push("## Right now\nWhat they wrote sounds hard for them. Receive it first, gently and precisely, before any task; then help, in small, kind steps.");
  }

  return { text: sections.join("\n\n"), care };
}
