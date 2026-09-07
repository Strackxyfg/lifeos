import type { NotionPropertySchema } from "./client";
import type { OnboardingAnswers } from "@/lib/onboarding";

/**
 * The LifeOS blueprint layer.
 * Maps onboarding answers → a set of database blueprints (schema + seed +
 * relations). This is the deterministic core; the model only tunes copy,
 * seed content, and which optional modules to include.
 */

export interface DatabaseBlueprint {
  key: string;
  title: string;
  icon: string;
  properties: Record<string, NotionPropertySchema>;
  /** Relations to wire after all databases exist (by target key). */
  relations?: { prop: string; to: string }[];
  /** Seed rows to make the workspace feel alive on first open. */
  seed?: Record<string, unknown>[];
}

const sel = (...names: string[]): NotionPropertySchema => ({
  select: { options: names.map((name) => ({ name })) },
});

/** All available blueprints, keyed. */
export const blueprints: Record<string, DatabaseBlueprint> = {
  projects: {
    key: "projects",
    title: "Projects",
    icon: "📦",
    properties: {
      Name: { title: {} },
      Status: sel("Planning", "In progress", "Blocked", "Done"),
      Priority: sel("Low", "Medium", "High"),
      Due: { date: {} },
      Progress: { number: { format: "percent" } },
    },
    relations: [
      { prop: "Goals", to: "goals" },
      { prop: "Meetings", to: "meetings" },
    ],
  },
  tasks: {
    key: "tasks",
    title: "Tasks",
    icon: "✅",
    properties: {
      Name: { title: {} },
      Status: { status: {} },
      Do: { date: {} },
      Effort: sel("XS", "S", "M", "L", "XL"),
    },
    relations: [{ prop: "Project", to: "projects" }],
  },
  goals: {
    key: "goals",
    title: "Goal Tracker",
    icon: "🎯",
    properties: {
      Name: { title: {} },
      Horizon: sel("Quarter", "Year", "Life"),
      Progress: { number: { format: "percent" } },
      Status: sel("On track", "At risk", "Hit"),
    },
  },
  weeklyPlanner: {
    key: "weeklyPlanner",
    title: "Weekly Planner",
    icon: "🗓️",
    properties: {
      Week: { title: {} },
      Start: { date: {} },
      Focus: { rich_text: {} },
      Reflection: { rich_text: {} },
    },
  },
  habits: {
    key: "habits",
    title: "Habit Tracker",
    icon: "🔁",
    properties: {
      Habit: { title: {} },
      Cadence: sel("Daily", "Weekly"),
      Done: { checkbox: {} },
      Streak: { number: {} },
    },
  },
  journal: {
    key: "journal",
    title: "Journal",
    icon: "📓",
    properties: {
      Entry: { title: {} },
      Date: { date: {} },
      Mood: sel("😀", "🙂", "😐", "😕", "😞"),
    },
  },
  crm: {
    key: "crm",
    title: "CRM",
    icon: "🤝",
    properties: {
      Name: { title: {} },
      Company: { rich_text: {} },
      Stage: sel("Lead", "Qualified", "Proposal", "Won", "Lost"),
      Value: { number: { format: "dollar" } },
      Email: { email: {} },
      Next: { date: {} },
    },
  },
  finance: {
    key: "finance",
    title: "Finance",
    icon: "💰",
    properties: {
      Item: { title: {} },
      Type: sel("Income", "Expense"),
      Amount: { number: { format: "dollar" } },
      Category: sel("Revenue", "Payroll", "Tools", "Marketing", "Other"),
      Date: { date: {} },
    },
  },
  knowledge: {
    key: "knowledge",
    title: "Knowledge Base",
    icon: "📚",
    properties: {
      Title: { title: {} },
      Type: sel("Note", "Idea", "Reference", "How-to"),
      Tags: { multi_select: { options: [{ name: "product" }, { name: "growth" }, { name: "eng" }] } },
    },
  },
  reading: {
    key: "reading",
    title: "Reading Tracker",
    icon: "📖",
    properties: {
      Title: { title: {} },
      Author: { rich_text: {} },
      Status: sel("To read", "Reading", "Finished"),
      Rating: sel("★", "★★", "★★★", "★★★★", "★★★★★"),
    },
  },
  meetings: {
    key: "meetings",
    title: "Meeting Notes",
    icon: "🗒️",
    properties: {
      Title: { title: {} },
      Date: { date: {} },
      Decisions: { rich_text: {} },
    },
    relations: [{ prop: "Project", to: "projects" }],
  },
};

/** Resolve which blueprints to build for a given user. Deterministic + testable. */
export function selectBlueprints(a: Partial<OnboardingAnswers>): DatabaseBlueprint[] {
  const keys = new Set<string>([
    "projects", "tasks", "goals", "weeklyPlanner", "habits", "journal",
  ]);
  if (a.needsCrm) keys.add("crm");
  if (a.needsFinance) keys.add("finance");
  if (a.needsLearning) { keys.add("knowledge"); keys.add("reading"); }
  if (a.goals?.includes("Team & meetings") || (a.team && a.team !== "Solo")) keys.add("meetings");
  return Array.from(keys).map((k) => blueprints[k]);
}
