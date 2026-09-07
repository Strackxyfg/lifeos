import type { Locale } from "@/lib/i18n/config";
import type { WorkspaceSnapshot } from "@/lib/data/workspace";

export type InsightKind = "daily" | "weekly";

export interface Insight {
  headline: string;
  body: string;
  actions: string[];
  /** Where the text came from — surfaced in the UI so provenance is honest. */
  source: "ai" | "computed";
  generatedAt: string;
}

const money = (n: number, locale: Locale) =>
  new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Flattens the snapshot into compact facts for the model.
 * Giving the LLM pre-computed numbers stops it inventing figures.
 */
export function snapshotFacts(s: WorkspaceSnapshot, locale: Locale): string {
  const p = s.projects;
  return [
    `Projects: ${p.total} total — ${p.inProgress} in progress, ${p.planning} planning, ${p.blocked} blocked, ${p.done} done. Average progress ${p.avgProgress}%.`,
    p.blockedNames.length ? `Blocked: ${p.blockedNames.join(", ")}.` : "Nothing blocked.",
    `Lowest-progress items: ${p.dueSoon.map((d) => `${d.name} (${d.progress}%, due ${d.due})`).join("; ")}.`,
    `Finance: income ${money(s.finance.income, locale)}, expenses ${money(s.finance.expense, locale)}, net ${money(s.finance.net, locale)}. Biggest expense category: ${s.finance.topExpense}.`,
    `Pipeline: ${s.crm.openCount} open deals worth ${money(s.crm.openValue, locale)}; ${money(s.crm.wonValue, locale)} won. Next actions: ${s.crm.nextActions.join("; ")}.`,
    `Today's tasks: ${s.tasks.done}/${s.tasks.total} done, ${s.tasks.open} open.`,
    `Habit streak: ${s.habitStreak} days.`,
  ].join("\n");
}

export function insightPrompt(kind: InsightKind, locale: Locale): string {
  const lang = locale === "fr" ? "French" : "English";
  const role =
    kind === "weekly"
      ? "Write a weekly review: what moved, what slipped, and the single biggest risk."
      : "Write a short morning briefing: what matters today and what to protect time for.";

  return [
    "You are LifeOS, a sharp AI chief-of-staff inside a personal operating system.",
    role,
    `Write in ${lang}. Be concrete and cite the real numbers you are given — never invent figures.`,
    "Return ONLY JSON with this exact shape:",
    '{"headline": string (max 8 words), "body": string (2-3 sentences, max 55 words), "actions": string[] (exactly 3 imperative next steps, max 12 words each)}',
  ].join(" ");
}

/**
 * Deterministic, data-driven fallback used when no AI key is configured.
 * It is derived from the same snapshot, so it stays factually accurate —
 * just less eloquent than the model.
 */
export function computeInsight(
  kind: InsightKind,
  s: WorkspaceSnapshot,
  locale: Locale
): Insight {
  const p = s.projects;
  const blocked = p.blockedNames[0];
  const weakest = p.dueSoon[0];
  const deal = s.crm.nextActions[0];
  const fr = locale === "fr";

  const headline = fr
    ? kind === "weekly"
      ? `${p.done} terminé${p.done > 1 ? "s" : ""}, ${p.blocked} bloqué${p.blocked > 1 ? "s" : ""}`
      : `${s.tasks.open} tâche${s.tasks.open > 1 ? "s" : ""} à traiter aujourd'hui`
    : kind === "weekly"
      ? `${p.done} shipped, ${p.blocked} blocked`
      : `${s.tasks.open} open task${s.tasks.open > 1 ? "s" : ""} today`;

  const body = fr
    ? kind === "weekly"
      ? `Vos ${p.total} projets avancent à ${p.avgProgress} % en moyenne : ${p.inProgress} en cours, ${p.done} terminé${p.done > 1 ? "s" : ""}. ` +
        (blocked ? `« ${blocked} » est bloqué et reste votre principal risque. ` : "Rien n'est bloqué. ") +
        `Côté finances, le net ressort à ${money(s.finance.net, locale)}.`
      : `${s.tasks.done} tâche${s.tasks.done > 1 ? "s" : ""} sur ${s.tasks.total} déjà faite${s.tasks.done > 1 ? "s" : ""}, ${s.tasks.open} restante${s.tasks.open > 1 ? "s" : ""}. ` +
        (blocked ? `« ${blocked} » est bloqué — à débloquer en priorité. ` : "") +
        `${s.crm.openCount} opportunités ouvertes pour ${money(s.crm.openValue, locale)}. Série en cours : ${s.habitStreak} jours.`
    : kind === "weekly"
      ? `Your ${p.total} projects are averaging ${p.avgProgress}% progress — ${p.inProgress} in flight, ${p.done} done. ` +
        (blocked ? `"${blocked}" is blocked and remains your biggest risk. ` : "Nothing is blocked. ") +
        `Finance nets out at ${money(s.finance.net, locale)}.`
      : `${s.tasks.done} of ${s.tasks.total} tasks done, ${s.tasks.open} still open. ` +
        (blocked ? `"${blocked}" is blocked — clear it first. ` : "") +
        `${s.crm.openCount} open deals worth ${money(s.crm.openValue, locale)}. Streak: ${s.habitStreak} days.`;

  const actions = fr
    ? [
        blocked ? `Débloquer « ${blocked} » en priorité.` : "Garder l'élan sur les projets en cours.",
        weakest ? `Faire avancer « ${weakest.name} » (${weakest.progress} %, échéance ${weakest.due}).` : "Planifier la semaine à venir.",
        deal ? `Relancer ${deal}.` : "Réserver deux créneaux de concentration.",
      ]
    : [
        blocked ? `Unblock "${blocked}" first.` : "Keep momentum on projects in flight.",
        weakest ? `Push "${weakest.name}" forward (${weakest.progress}%, due ${weakest.due}).` : "Plan the week ahead.",
        deal ? `Follow up — ${deal}.` : "Protect two deep-work blocks.",
      ];

  return { headline, body, actions, source: "computed", generatedAt: new Date().toISOString() };
}
