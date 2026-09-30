import { ageInDays } from "@/lib/brain/focus";
import { neighborsOf, openTensions, type LinkLike, type NoteLike } from "@/lib/brain/graph";
import { parseReminder } from "@/lib/reminders/parse";
import type { RhythmSummary } from "./rhythm";
import type { TraitLike } from "./portrait";

/**
 * What the double suggests: advice read off the brain, never made up.
 *
 * Each detector below looks for one precise situation in the person's own
 * notes, connections, reminders and check-ins, and says what it found as
 * data (`facts`), which the page words in their language — the same finding
 * always gives the same advice, with or without a model. Each comes with
 * what can be done about it in one click (`actions`), and a stable `key`: set
 * aside, it stays aside; put off, it comes back on its date; done, it is not
 * raised again.
 *
 * Kinds, most pressing first:
 *  - commitment      a next step names a day ("call Marc on Monday") that is
 *                    still ahead, and nothing will remind them: set a reminder
 *                    for that moment.
 *  - overdue         a next step named a day that has passed, within two
 *                    weeks, and it is still open: done, or remind again.
 *  - goal-stuck      a goal a week old or more, with no open next step
 *                    connected to it: propose steps.
 *  - energy-low      their energy has been low in the check-ins of the last
 *                    week: see which steps can wait. Not a diagnosis.
 *  - tension         two notes pulling against each other, undecided for
 *                    three days or more: decide.
 *  - step-stale      a next step open for three weeks or more, no reminder:
 *                    done, remind, or open it.
 *  - portrait        the double has several observations waiting for them to
 *                    confirm or reject.
 *  - overload        many open steps, many of them serving no goal: choose.
 *  - idea-loose      an idea two weeks to two months old, connected to
 *                    nothing: find its connections.
 */

export type AdviceKind =
  | "commitment"
  | "overdue"
  | "goal-stuck"
  | "energy-low"
  | "tension"
  | "step-stale"
  | "portrait"
  | "overload"
  | "idea-loose";

export type AdviceAction =
  /** Opens the note. */
  | { type: "open"; noteId: string }
  /** Proposes next steps for a goal (the model, then the person picks). */
  | { type: "steps"; noteId: string }
  /** Marks a next step done. */
  | { type: "done"; noteId: string }
  /** Sets a reminder about a note, at a moment. */
  | { type: "remind"; noteId: string; title: string; at: string }
  /** Opens the decision view for a tension. */
  | { type: "decide"; linkId: string }
  /** Looks for a note's connections. */
  | { type: "weave"; noteId: string }
  /** Opens the list of next steps. */
  | { type: "steps-list" }
  /** Opens the portrait, on what is waiting. */
  | { type: "portrait" };

export interface Advice {
  key: string;
  kind: AdviceKind;
  /** Higher first. */
  priority: number;
  /** The notes it is about. */
  noteIds: string[];
  /** What was found, for the page to word: titles, counts, days, moments. */
  facts: Record<string, string | number>;
  actions: AdviceAction[];
}

export interface AdviceState {
  adviceKey: string;
  status: "dismissed" | "snoozed" | "done";
  until: string | null;
}

export interface AdviceInput {
  notes: NoteLike[];
  links: (LinkLike & { id?: string; createdAt?: string })[];
  /** The person's reminders: those about a note count as "it will be remembered". */
  reminders: { noteId: string | null; done: boolean; dueAt: string }[];
  rhythm: RhythmSummary | null;
  traits: TraitLike[];
  states: AdviceState[];
  now: Date;
  /** Their time zone, for moments ("on Monday" is Monday there). */
  zone: string;
  locale: "fr" | "en";
  limit?: number;
}

const DAY = 86_400_000;
export const ADVICE_LIMITS = {
  goalQuietDays: 7,
  staleStepDays: 21,
  tensionDays: 3,
  overdueDays: 14,
  commitmentHorizonDays: 60,
  overloadOpen: 12,
  overloadUnaligned: 6,
  ideaMinDays: 14,
  ideaMaxDays: 60,
  lowEnergy: 2.2,
  lowEnergyN: 3,
  pendingTraits: 3,
} as const;

/** ISO week, "2026-W40": the key of advice that may come back week after week. */
export function isoWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Tomorrow at 9:00 where they are — the moment a "remind me" defaults to. */
export function tomorrowMorning(now: Date, zone: string, locale: "fr" | "en"): Date {
  return parseReminder(locale === "fr" ? "demain à 9h" : "tomorrow at 9am", now, zone, locale).dueAt ?? new Date(now.getTime() + DAY);
}

/**
 * Whether a text names a time of day ("à 14h", "10:30", "3pm", "midi"). The
 * reminder parser puts a moment at 9:00 when only a day is said; advice
 * then speaks of the day alone, and does not claim a time nobody said.
 */
export function namesTime(text: string): boolean {
  return /(?<![\p{L}\d])(\d{1,2}\s?(h|heures?)(\s?\d{2})?|\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|midi|minuit|noon|midnight)(?![\p{L}\d])/iu.test(text);
}

/** Whether advice is hidden by what the person did with it. */
function hidden(key: string, states: Map<string, AdviceState>, now: Date): boolean {
  const s = states.get(key);
  if (!s) return false;
  if (s.status === "snoozed") return s.until !== null && Date.parse(s.until) > now.getTime();
  return true;
}

export function adviseFor(input: AdviceInput): Advice[] {
  const { notes, reminders, rhythm, traits, now, zone, locale, limit = 6 } = input;
  const states = new Map(input.states.map((s) => [s.adviceKey, s]));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const serving = input.links.filter((l) => (l.kind ?? "related") !== "tension");
  const reminded = new Set(reminders.filter((r) => !r.done && r.noteId).map((r) => r.noteId as string));
  const out: Advice[] = [];
  const openSteps = notes.filter((n) => n.category === "next" && !n.done && !n.id.startsWith("temp-"));
  const servesGoal = (id: string) => [...neighborsOf(id, serving)].some((g) => byId.get(g)?.category === "goals" && !byId.get(g)?.done);

  // Moments named in next steps, read from the day each was written.
  const flagged = new Set<string>();
  for (const step of openSteps) {
    if (reminded.has(step.id)) continue;
    const written = new Date(step.createdAt);
    if (Number.isNaN(written.getTime())) continue;
    const parsed = parseReminder(step.title, written, zone, locale);
    if (!parsed.dueAt || parsed.repeat !== "none") continue;
    const due = parsed.dueAt.getTime();
    const title = parsed.title.trim() || step.title;
    if (due > now.getTime() && due - now.getTime() <= ADVICE_LIMITS.commitmentHorizonDays * DAY) {
      out.push({
        key: `commitment:${step.id}`,
        kind: "commitment",
        priority: 95 - Math.min(20, (due - now.getTime()) / DAY),
        noteIds: [step.id],
        facts: { title: step.title, at: parsed.dueAt.toISOString(), timed: namesTime(step.title) ? 1 : 0 },
        actions: [{ type: "remind", noteId: step.id, title, at: parsed.dueAt.toISOString() }, { type: "open", noteId: step.id }],
      });
      flagged.add(step.id);
    } else if (due <= now.getTime() && now.getTime() - due <= ADVICE_LIMITS.overdueDays * DAY) {
      out.push({
        key: `overdue:${step.id}`,
        kind: "overdue",
        priority: 88,
        noteIds: [step.id],
        facts: {
          title: step.title,
          at: parsed.dueAt.toISOString(),
          timed: namesTime(step.title) ? 1 : 0,
          days: Math.max(1, Math.floor((now.getTime() - due) / DAY)),
        },
        actions: [
          { type: "done", noteId: step.id },
          { type: "remind", noteId: step.id, title, at: tomorrowMorning(now, zone, locale).toISOString() },
        ],
      });
      flagged.add(step.id);
    }
  }

  // Goals with no way forward.
  for (const g of notes) {
    if (g.category !== "goals" || g.done) continue;
    const days = ageInDays(g.createdAt, now);
    if (days < ADVICE_LIMITS.goalQuietDays) continue;
    const hasStep = [...neighborsOf(g.id, serving)].some((id) => byId.get(id)?.category === "next" && !byId.get(id)?.done);
    if (hasStep) continue;
    out.push({
      key: `goal-stuck:${g.id}`,
      kind: "goal-stuck",
      priority: 80 + Math.min(10, days / 6),
      noteIds: [g.id],
      facts: { title: g.title, days },
      actions: [{ type: "steps", noteId: g.id }, { type: "open", noteId: g.id }],
    });
  }

  // Low energy, by their own account.
  const energy = rhythm?.week.energy.recent;
  if (energy && energy.n >= ADVICE_LIMITS.lowEnergyN && energy.mean <= ADVICE_LIMITS.lowEnergy) {
    const unaligned = openSteps.filter((s) => !servesGoal(s.id)).length;
    out.push({
      key: `energy-low:${isoWeek(now)}`,
      kind: "energy-low",
      priority: 78,
      noteIds: [],
      facts: { mean: energy.mean, n: energy.n, unaligned },
      actions: [{ type: "steps-list" }],
    });
  }

  // Tensions waiting for a decision.
  for (const l of openTensions(input.links)) {
    if (!l.id) continue;
    const a = byId.get(l.fromId);
    const b = byId.get(l.toId);
    if (!a || !b || a.done || b.done) continue;
    const since = l.createdAt ? ageInDays(l.createdAt, now) : ADVICE_LIMITS.tensionDays;
    if (since < ADVICE_LIMITS.tensionDays) continue;
    out.push({
      key: `tension:${l.id}`,
      kind: "tension",
      priority: 72 + Math.min(6, since / 5),
      noteIds: [a.id, b.id],
      facts: { a: a.title, b: b.title, days: since },
      actions: [{ type: "decide", linkId: l.id }],
    });
  }

  // Steps left open for weeks, the oldest two.
  const stale = openSteps
    .filter((s) => !flagged.has(s.id) && !reminded.has(s.id) && ageInDays(s.createdAt, now) >= ADVICE_LIMITS.staleStepDays)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, 2);
  for (const s of stale) {
    const days = ageInDays(s.createdAt, now);
    out.push({
      key: `step-stale:${s.id}`,
      kind: "step-stale",
      priority: 60 + Math.min(10, days / 9),
      noteIds: [s.id],
      facts: { title: s.title, days },
      actions: [
        { type: "done", noteId: s.id },
        { type: "remind", noteId: s.id, title: s.title, at: tomorrowMorning(now, zone, locale).toISOString() },
        { type: "open", noteId: s.id },
      ],
    });
  }

  // Observations waiting for the person's word. Keyed on the newest one: a
  // new observation brings the advice back after it was set aside.
  const pending = traits.filter((t) => t.status === "proposed").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (pending.length >= ADVICE_LIMITS.pendingTraits) {
    out.push({
      key: `portrait:${pending[0].id}`,
      kind: "portrait",
      priority: 45,
      noteIds: [],
      facts: { count: pending.length },
      actions: [{ type: "portrait" }],
    });
  }

  // Too much open at once.
  const unaligned = openSteps.filter((s) => !servesGoal(s.id)).length;
  if (openSteps.length >= ADVICE_LIMITS.overloadOpen && unaligned >= ADVICE_LIMITS.overloadUnaligned) {
    out.push({
      key: `overload:${isoWeek(now)}`,
      kind: "overload",
      priority: 50,
      noteIds: [],
      facts: { open: openSteps.length, unaligned },
      actions: [{ type: "steps-list" }],
    });
  }

  // One loose idea, the oldest still worth saving.
  const loose = notes
    .filter((n) => n.category === "ideas" && !n.done)
    .filter((n) => {
      const days = ageInDays(n.createdAt, now);
      return days >= ADVICE_LIMITS.ideaMinDays && days <= ADVICE_LIMITS.ideaMaxDays && neighborsOf(n.id, input.links).size === 0;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
  if (loose) {
    out.push({
      key: `idea-loose:${loose.id}`,
      kind: "idea-loose",
      priority: 30,
      noteIds: [loose.id],
      facts: { title: loose.title, days: ageInDays(loose.createdAt, now) },
      actions: [{ type: "weave", noteId: loose.id }, { type: "open", noteId: loose.id }],
    });
  }

  return out
    .filter((a) => !hidden(a.key, states, now))
    .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** An advice key as sent back by the page: shape-checked. */
export function isAdviceKey(v: unknown): v is string {
  return typeof v === "string" && /^(commitment|overdue|goal-stuck|energy-low|tension|step-stale|portrait|overload|idea-loose):[0-9A-Za-z_-]{1,80}$/.test(v);
}
