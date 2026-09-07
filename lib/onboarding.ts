import { z } from "zod";

/** The 10 onboarding questions that drive workspace generation. */
export type QuestionType = "text" | "single" | "multi" | "boolean";

export interface Question {
  id: keyof OnboardingAnswers;
  type: QuestionType;
  title: string;
  subtitle?: string;
  placeholder?: string;
  options?: string[];
  optional?: boolean;
}

export const questions: Question[] = [
  { id: "name", type: "text", title: "First, what should we call you?", subtitle: "Your workspace will be personalized to you.", placeholder: "e.g. Quinn" },
  { id: "profession", type: "single", title: "What best describes your work?", options: ["Founder / Operator", "Freelancer / Creator", "Manager / Lead", "Engineer / Designer", "Student / Researcher", "Something else"] },
  { id: "goals", type: "multi", title: "What are you trying to get on top of?", subtitle: "Pick everything that applies — this shapes your databases.", options: ["Projects & tasks", "Personal goals", "Finances", "Clients & sales", "Habits & health", "Learning & notes", "Team & meetings", "Content & writing"] },
  { id: "projects", type: "single", title: "How many active projects do you juggle?", options: ["Just 1–2", "3–5", "6–10", "10+"] },
  { id: "team", type: "single", title: "How big is your team?", options: ["Solo", "2–5", "6–20", "20+"] },
  { id: "revenue", type: "single", title: "What's your monthly revenue, roughly?", subtitle: "Used to right-size your finance module. Never shared.", options: ["Pre-revenue", "< $5k", "$5k–$50k", "$50k+"] },
  { id: "usesNotion", type: "boolean", title: "Do you already use Notion?", subtitle: "We'll build into your account, or create one for you." },
  { id: "needsCrm", type: "boolean", title: "Want a CRM to track contacts & deals?" },
  { id: "needsFinance", type: "boolean", title: "Want finance tracking — income, expenses, runway?" },
  { id: "needsLearning", type: "boolean", title: "Want a knowledge base for notes & reading?" },
];

export const onboardingSchema = z.object({
  name: z.string().min(1).max(60),
  profession: z.string().min(1),
  goals: z.array(z.string()).min(1),
  projects: z.string().min(1),
  team: z.string().min(1),
  revenue: z.string().min(1),
  usesNotion: z.boolean(),
  needsCrm: z.boolean(),
  needsFinance: z.boolean(),
  needsLearning: z.boolean(),
});

export type OnboardingAnswers = z.infer<typeof onboardingSchema>;

/** Derive which databases to build from answers — the generation blueprint. */
export function planFromAnswers(a: Partial<OnboardingAnswers>): string[] {
  const plan = new Set<string>(["Projects", "Weekly Planner", "Goal Tracker", "Journal", "Habit Tracker"]);
  if (a.needsCrm) plan.add("CRM");
  if (a.needsFinance) plan.add("Finance");
  if (a.needsLearning) { plan.add("Knowledge Base"); plan.add("Reading Tracker"); }
  if (a.goals?.includes("Team & meetings") || (a.team && a.team !== "Solo")) plan.add("Meeting Notes");
  return Array.from(plan);
}
