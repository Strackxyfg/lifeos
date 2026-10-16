import type { MapStyle, Outline } from "./model";

/**
 * Starting points: the structure of a kind of thinking, never content. Each
 * says what it is for and how it looks best; the person fills it in.
 */

export type TemplateId = "blank" | "brainstorm" | "project" | "swot" | "decision" | "week" | "book" | "meeting" | "goals";

export interface Template {
  id: TemplateId;
  emoji: string;
  name: string;
  hint: string;
  style: Partial<MapStyle>;
  outline: Outline;
}

type Lang = "en" | "fr";
const t = (lang: Lang, en: string, fr: string) => (lang === "fr" ? fr : en);
const leaf = (text: string, emoji?: string): Outline => (emoji ? { text, emoji } : { text });

export function templates(lang: Lang): Template[] {
  return [
    {
      id: "blank",
      emoji: "✳️",
      name: t(lang, "Blank map", "Carte vierge"),
      hint: t(lang, "One central idea, and everything that comes to you.", "Une idée centrale, et tout ce qui vous vient."),
      style: {},
      outline: { text: t(lang, "Central idea", "Idée centrale") },
    },
    {
      id: "brainstorm",
      emoji: "💡",
      name: t(lang, "Brainstorm", "Remue-méninges"),
      hint: t(lang, "Six questions to open up a subject.", "Six questions pour ouvrir un sujet."),
      style: { theme: "aurora", layout: "map" },
      outline: {
        text: t(lang, "Subject", "Sujet"),
        children: [
          leaf(t(lang, "Why?", "Pourquoi ?"), "❓"),
          leaf(t(lang, "For whom?", "Pour qui ?"), "👥"),
          leaf(t(lang, "What exactly?", "Quoi exactement ?"), "🎯"),
          leaf(t(lang, "How?", "Comment ?"), "🛠️"),
          leaf(t(lang, "What could stop it?", "Qu'est-ce qui pourrait bloquer ?"), "⚠️"),
          leaf(t(lang, "First step", "Premier pas"), "🚀"),
        ],
      },
    },
    {
      id: "project",
      emoji: "🗂️",
      name: t(lang, "Project plan", "Plan de projet"),
      hint: t(lang, "Goal, deliverables, phases, people, risks.", "Objectif, livrables, étapes, équipe, risques."),
      style: { theme: "daylight", layout: "right", edge: "elbow" },
      outline: {
        text: t(lang, "Project", "Projet"),
        children: [
          { text: t(lang, "Goal", "Objectif"), emoji: "🎯", children: [leaf(t(lang, "What success looks like", "À quoi ressemble la réussite"))] },
          { text: t(lang, "Deliverables", "Livrables"), emoji: "📦" },
          {
            text: t(lang, "Phases", "Étapes"),
            emoji: "🗓️",
            children: [leaf(t(lang, "Phase 1", "Phase 1")), leaf(t(lang, "Phase 2", "Phase 2")), leaf(t(lang, "Phase 3", "Phase 3"))],
          },
          { text: t(lang, "Team", "Équipe"), emoji: "👥" },
          { text: t(lang, "Risks", "Risques"), emoji: "⚠️" },
          { text: t(lang, "Budget", "Budget"), emoji: "💰" },
        ],
      },
    },
    {
      id: "swot",
      emoji: "🧭",
      name: t(lang, "SWOT", "SWOT"),
      hint: t(lang, "Strengths, weaknesses, opportunities, threats.", "Forces, faiblesses, opportunités, menaces."),
      style: { theme: "forest", layout: "map" },
      outline: {
        text: t(lang, "Situation", "Situation"),
        children: [
          leaf(t(lang, "Strengths", "Forces"), "💪"),
          leaf(t(lang, "Weaknesses", "Faiblesses"), "🩹"),
          leaf(t(lang, "Opportunities", "Opportunités"), "🌱"),
          leaf(t(lang, "Threats", "Menaces"), "⛈️"),
        ],
      },
    },
    {
      id: "decision",
      emoji: "⚖️",
      name: t(lang, "Decision", "Décision"),
      hint: t(lang, "Options side by side, for and against, and what matters.", "Les options côte à côte, le pour, le contre, et ce qui compte."),
      style: { theme: "paper", layout: "map" },
      outline: {
        text: t(lang, "Decision to make", "Décision à prendre"),
        children: [
          { text: t(lang, "Option A", "Option A"), children: [leaf(t(lang, "For", "Pour"), "👍"), leaf(t(lang, "Against", "Contre"), "👎")] },
          { text: t(lang, "Option B", "Option B"), children: [leaf(t(lang, "For", "Pour"), "👍"), leaf(t(lang, "Against", "Contre"), "👎")] },
          { text: t(lang, "What matters most", "Ce qui compte le plus"), emoji: "⭐" },
          { text: t(lang, "My choice, and why", "Mon choix, et pourquoi"), emoji: "✅" },
        ],
      },
    },
    {
      id: "week",
      emoji: "📅",
      name: t(lang, "Weekly review", "Revue de la semaine"),
      hint: t(lang, "What went well, what you learned, what comes next.", "Ce qui a marché, ce que vous avez appris, la suite."),
      style: { theme: "pastel", layout: "map" },
      outline: {
        text: t(lang, "My week", "Ma semaine"),
        children: [
          leaf(t(lang, "Wins", "Victoires"), "🏆"),
          leaf(t(lang, "Lessons", "Leçons"), "📚"),
          leaf(t(lang, "What blocked me", "Ce qui m'a freiné"), "🧱"),
          leaf(t(lang, "Next week's priorities", "Priorités de la semaine prochaine"), "🎯"),
        ],
      },
    },
    {
      id: "book",
      emoji: "📖",
      name: t(lang, "Book notes", "Notes de lecture"),
      hint: t(lang, "Key ideas, quotes, what to apply.", "Idées clés, citations, ce que j'applique."),
      style: { theme: "paper", layout: "right", font: "serif" },
      outline: {
        text: t(lang, "Book title", "Titre du livre"),
        children: [
          leaf(t(lang, "Key ideas", "Idées clés"), "💡"),
          leaf(t(lang, "Quotes", "Citations"), "💬"),
          leaf(t(lang, "What I will apply", "Ce que j'applique"), "🛠️"),
          leaf(t(lang, "Questions it raises", "Questions qu'il soulève"), "❓"),
        ],
      },
    },
    {
      id: "meeting",
      emoji: "🤝",
      name: t(lang, "Meeting", "Réunion"),
      hint: t(lang, "Purpose, points, decisions, actions.", "But, points, décisions, actions."),
      style: { theme: "midnight", layout: "right" },
      outline: {
        text: t(lang, "Meeting", "Réunion"),
        children: [
          leaf(t(lang, "Purpose", "But"), "🎯"),
          leaf(t(lang, "Who", "Participants"), "👥"),
          leaf(t(lang, "Points", "Points abordés"), "🗒️"),
          leaf(t(lang, "Decisions", "Décisions"), "✅"),
          leaf(t(lang, "Actions — who, when", "Actions — qui, quand"), "📌"),
        ],
      },
    },
    {
      id: "goals",
      emoji: "🏔️",
      name: t(lang, "Goal and key results", "Objectif et résultats clés"),
      hint: t(lang, "One goal, how you will know, what you will do.", "Un objectif, comment vous saurez, ce que vous ferez."),
      style: { theme: "ocean", layout: "down" },
      outline: {
        text: t(lang, "Goal", "Objectif"),
        children: [1, 2, 3].map((n) => ({
          text: t(lang, `Key result ${n}`, `Résultat clé ${n}`),
          children: [leaf(t(lang, "Initiative", "Initiative"))],
        })),
      },
    },
  ];
}
