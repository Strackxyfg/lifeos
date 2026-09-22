import { fill, plural, type Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/dictionaries";
import type { FocusReason } from "./focus";
import type { ContextLabels } from "./context";

/**
 * Human wording for a focus reason. One function for the screen and for the
 * assistant's context, so the brain and the AI describe a priority identically.
 */
export function focusReasonText(r: FocusReason, m: Messages, locale: Locale): string {
  switch (r.code) {
    case "servesGoal":
      return fill(m.brain.reason.servesGoal, { goal: r.goal });
    case "waiting":
      return r.days === 0 ? m.brain.reason.waitingToday : plural(locale, r.days, m.brain.reason.waiting);
    case "goalWithoutAction":
      return m.brain.reason.goalWithoutAction;
    case "freshIdea":
      return m.brain.reason.freshIdea;
  }
}

export function contextLabels(m: Messages, locale: Locale): ContextLabels {
  return {
    about: m.assistant.contextAbout,
    name: m.assistant.aboutName,
    work: m.assistant.aboutWork,
    areas: m.assistant.aboutAreas,
    goals: m.brain.cat.goals.label,
    focus: m.brain.focusTitle,
    relevant: m.assistant.contextRelevant,
    recent: m.assistant.contextRecent,
    empty: m.assistant.contextEmpty,
    reason: (r) => focusReasonText(r, m, locale),
  };
}
