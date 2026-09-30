import type { Advice } from "./advice";
import { portraitSection, rhythmSection } from "./double";
import type { Portrait } from "./portrait";
import type { RhythmSummary } from "./rhythm";

/**
 * The double as the agent reads it (`self.read`): the person's portrait,
 * their check-ins as figures, what their double would raise now, and the
 * day's question — so the agent on Telegram can be the same second self as
 * the app, from the same findings. Read-only: the person still confirms
 * traits and acts on advice themselves, in the app or through the agent's
 * gated actions.
 */

function when(iso: string, zone: string, withTime: boolean): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", timeZone: zone };
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${new Intl.DateTimeFormat("en-GB", opts).format(d)} (${zone})`;
}

/** One piece of advice, as a line the agent can act on. */
export function adviceLine(a: Advice, zone: string): string {
  const f = a.facts;
  const q = (v: unknown) => `"${String(v)}"`;
  switch (a.kind) {
    case "commitment":
      return `- Next step ${q(f.title)} names ${when(String(f.at), zone, f.timed === 1)} and nothing will remind them: offer to set a reminder.`;
    case "overdue":
      return `- Next step ${q(f.title)} was due ${when(String(f.at), zone, f.timed === 1)} and is still open: ask whether it is done, or remind them.`;
    case "goal-stuck":
      return `- Goal ${q(f.title)} has no next step: help them find the first one.`;
    case "energy-low":
      return `- Their energy averaged ${f.mean}/5 over ${f.n} check-ins this week: go gently, suggest what can wait. Not a diagnosis.`;
    case "tension":
      return `- ${q(f.a)} and ${q(f.b)} pull against each other, undecided for ${f.days} days: help them decide.`;
    case "step-stale":
      return `- Next step ${q(f.title)} has waited ${f.days} days.`;
    case "portrait":
      return `- ${f.count} observations about them wait for their confirmation in the app.`;
    case "overload":
      return `- ${f.open} next steps are open, ${f.unaligned} of them serving no goal: help them choose.`;
    case "idea-loose":
      return `- Idea ${q(f.title)} is connected to nothing yet.`;
  }
}

export const BRIEF_SECTIONS = ["portrait", "checkins", "advice", "question"] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number];

export function isBriefSection(v: unknown): v is BriefSection {
  return typeof v === "string" && (BRIEF_SECTIONS as readonly string[]).includes(v);
}

export function selfBrief(input: {
  portrait: Portrait;
  rhythm: RhythmSummary | null;
  advice: Advice[];
  question: string | null;
  zone: string;
  /** One part only; everything when absent. */
  only?: BriefSection;
}): string {
  const want = (s: BriefSection) => !input.only || input.only === s;
  const parts: string[] = [];
  if (want("portrait")) parts.push(portraitSection(input.portrait));
  if (want("checkins")) parts.push(rhythmSection(input.rhythm) ?? (input.only ? "## Their check-ins\n(none yet)" : ""));
  if (want("advice")) {
    parts.push(
      input.advice.length
        ? `## What their double would raise now\n${input.advice.map((a) => adviceLine(a, input.zone)).join("\n")}`
        : "## What their double would raise now\n(nothing at the moment)"
    );
  }
  if (want("question")) {
    parts.push(
      input.question
        ? `## Today's question for them\n${input.question}\n(Ask it only if the conversation allows. Their answer can be kept with brain_write, in their words.)`
        : input.only
          ? "## Today's question for them\n(they have answered every question)"
          : ""
    );
  }
  return parts.filter(Boolean).join("\n\n");
}
