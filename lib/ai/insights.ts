import type { Locale } from "@/lib/i18n/config";
import type { WorkspaceSnapshot } from "@/lib/data/workspace";
import type { BrainDigest } from "@/lib/brain/digest";

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
  ].join("\n");
}

export function insightPrompt(kind: InsightKind, locale: Locale): string {
  const lang = locale === "fr" ? "French" : "English";
  // The second brain comes first: it is where the person says what matters.
  // Projects, deals and money are context, raised only when they matter.
  const role =
    kind === "weekly"
      ? "Write a weekly review: what was captured and connected in the second brain, which goals have no next step, " +
        "which tension deserves a decision, then what moved or slipped in projects — and the single biggest risk."
      : "Write a short morning briefing: start from the second brain's focus — what to do first and why — name a tension " +
        "to resolve if there is one, and mention projects, deals or money only if they matter today.";

  return [
    "You are LifeOS, the person's second brain and chief-of-staff.",
    role,
    `Write in ${lang}. Be concrete, quote the person's notes by their exact titles, and cite only the numbers you are given — never invent figures.`,
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
  locale: Locale,
  brain?: BrainDigest
): Insight {
  if (brain && (brain.focus.length > 0 || brain.capturedThisWeek > 0 || brain.tensions.length > 0)) {
    return fromBrain(kind, s, locale, brain);
  }
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
        `${s.crm.openCount} opportunités ouvertes pour ${money(s.crm.openValue, locale)}.`
    : kind === "weekly"
      ? `Your ${p.total} projects are averaging ${p.avgProgress}% progress — ${p.inProgress} in flight, ${p.done} done. ` +
        (blocked ? `"${blocked}" is blocked and remains your biggest risk. ` : "Nothing is blocked. ") +
        `Finance nets out at ${money(s.finance.net, locale)}.`
      : `${s.tasks.done} of ${s.tasks.total} tasks done, ${s.tasks.open} still open. ` +
        (blocked ? `"${blocked}" is blocked — clear it first. ` : "") +
        `${s.crm.openCount} open deals worth ${money(s.crm.openValue, locale)}.`;

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

/**
 * The computed briefing, when the second brain has something to say: its
 * focus, its tensions, its goals without a next step. Only facts from the
 * digest and the snapshot — nothing a model would have to be trusted for.
 */
function fromBrain(kind: InsightKind, s: WorkspaceSnapshot, locale: Locale, d: BrainDigest): Insight {
  const fr = locale === "fr";
  const q = (t: string) => (fr ? `« ${t} »` : `"${t}"`);
  const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`);
  const pl = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

  /** What to do about a focus entry, as an instruction. */
  const act = (f: BrainDigest["focus"][number]): string => {
    switch (f.reason.code) {
      case "goalWithoutAction":
        return fr ? `Définir une prochaine action pour ${q(clip(f.title, 50))}.` : `Set a next step for ${q(clip(f.title, 50))}.`;
      case "freshIdea":
        return fr ? `Relier ou développer ${q(clip(f.title, 50))}.` : `Connect or develop ${q(clip(f.title, 50))}.`;
      default:
        return `${clip(f.title, 70)}${/[.!?]$/.test(f.title) ? "" : "."}`;
    }
  };

  const tension = d.tensions[0];
  const actions: string[] = [];
  const push = (a: string) => {
    if (actions.length < 3 && !actions.includes(a)) actions.push(a);
  };

  if (kind === "daily") {
    const first = d.focus[0];
    const headline = first
      ? fr
        ? `Priorité : ${clip(first.title, 48)}`
        : `Priority: ${clip(first.title, 48)}`
      : fr
        ? `${pl(s.tasks.open, "tâche ouverte", "tâches ouvertes")}`
        : `${pl(s.tasks.open, "open task", "open tasks")}`;
    const body = [
      first
        ? fr
          ? `Votre focus commence par ${q(first.title)}.`
          : `Your focus starts with ${q(first.title)}.`
        : fr
          ? "Rien de pressant dans votre focus."
          : "Nothing pressing in your focus.",
      tension
        ? fr
          ? `À arbitrer : ${q(tension.a)} et ${q(tension.b)} tirent en sens contraire.`
          : `To resolve: ${q(tension.a)} and ${q(tension.b)} pull against each other.`
        : "",
      fr
        ? `${pl(s.tasks.open, "tâche reste ouverte", "tâches restent ouvertes")} aujourd'hui.`
        : `${pl(s.tasks.open, "task is", "tasks are")} still open today.`,
    ]
      .filter(Boolean)
      .join(" ");
    d.focus.forEach((f) => push(act(f)));
    if (tension) push(fr ? `Arbitrer ${q(clip(tension.a, 40))} / ${q(clip(tension.b, 40))}.` : `Decide between ${q(clip(tension.a, 40))} and ${q(clip(tension.b, 40))}.`);
    push(fr ? "Capturer ce qui vous passe par la tête avant midi." : "Capture what is on your mind before noon.");
    return { headline, body, actions, source: "computed", generatedAt: new Date().toISOString() };
  }

  const headline = fr
    ? `${pl(d.capturedThisWeek, "note", "notes")}, ${pl(d.connectedThisWeek, "connexion", "connexions")} cette semaine`
    : `${pl(d.capturedThisWeek, "note", "notes")}, ${pl(d.connectedThisWeek, "connection", "connections")} this week`;
  const body = [
    d.goalsWithoutStep.length
      ? fr
        ? `${d.goalsWithoutStep.length === 1 ? "Un objectif n'a" : `${d.goalsWithoutStep.length} objectifs n'ont`} pas de prochaine action : ${d.goalsWithoutStep.map(q).join(", ")}.`
        : `${d.goalsWithoutStep.length === 1 ? "One goal has" : `${d.goalsWithoutStep.length} goals have`} no next step: ${d.goalsWithoutStep.map(q).join(", ")}.`
      : fr
        ? `Vos ${pl(d.openGoals, "objectif ouvert a", "objectifs ouverts ont")} tous une prochaine action.`
        : `All ${pl(d.openGoals, "open goal has", "open goals have")} a next step.`,
    tension
      ? fr
        ? `Une tension demande une décision : ${q(tension.a)} face à ${q(tension.b)}.`
        : `A tension needs a decision: ${q(tension.a)} against ${q(tension.b)}.`
      : "",
    fr
      ? `Projets : ${s.projects.avgProgress} % d'avancement moyen, ${pl(s.projects.blocked, "bloqué", "bloqués")}.`
      : `Projects: ${s.projects.avgProgress}% average progress, ${s.projects.blocked} blocked.`,
  ]
    .filter(Boolean)
    .join(" ");
  d.goalsWithoutStep.forEach((g) => push(fr ? `Définir une prochaine action pour ${q(clip(g, 50))}.` : `Set a next step for ${q(clip(g, 50))}.`));
  if (tension) push(fr ? `Arbitrer ${q(clip(tension.a, 40))} / ${q(clip(tension.b, 40))}.` : `Decide between ${q(clip(tension.a, 40))} and ${q(clip(tension.b, 40))}.`);
  if (d.awaitingReview) push(fr ? `Valider les ${pl(d.awaitingReview, "connexion proposée", "connexions proposées")}.` : `Review the ${pl(d.awaitingReview, "proposed connection", "proposed connections")}.`);
  d.focus.forEach((f) => push(act(f)));
  push(fr ? "Planifier la semaine à venir." : "Plan the week ahead.");
  return { headline, body, actions, source: "computed", generatedAt: new Date().toISOString() };
}
