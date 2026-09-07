import {
  Boxes, Users, Wallet, Repeat, BookOpen, NotebookPen,
  CalendarRange, Target, Library, ClipboardList,
  Sparkles, CalendarDays, Mail, MessageSquare, CreditCard, Github,
  type LucideIcon,
} from "lucide-react";

export const site = {
  name: "LifeOS AI",
  tagline: "Your entire life, organized in 60 seconds.",
  description:
    "LifeOS AI generates a complete, personalized Notion workspace — databases, dashboards, automations and an AI assistant — tailored to you in under a minute.",
  nav: [
    { label: "Product", href: "#product" },
    { label: "How it works", href: "#how" },
    { label: "Pricing", href: "#pricing" },
    { label: "FAQ", href: "#faq" },
  ],
};

/** The 10 databases LifeOS generates. Order = perceived value. */
export const databases: { name: string; desc: string; icon: LucideIcon }[] = [
  { name: "Projects", desc: "Timelines, status, owners, and linked tasks.", icon: Boxes },
  { name: "CRM", desc: "Contacts, deals, and pipeline stages.", icon: Users },
  { name: "Finance", desc: "Income, expenses, runway, and budgets.", icon: Wallet },
  { name: "Habit Tracker", desc: "Streaks, cadence, and weekly rollups.", icon: Repeat },
  { name: "Knowledge Base", desc: "A second brain that stays searchable.", icon: BookOpen },
  { name: "Journal", desc: "Daily notes with mood and prompts.", icon: NotebookPen },
  { name: "Weekly Planner", desc: "Time-blocked weeks synced to calendar.", icon: CalendarRange },
  { name: "Goal Tracker", desc: "OKRs cascading to projects and tasks.", icon: Target },
  { name: "Reading Tracker", desc: "Library, highlights, and progress.", icon: Library },
  { name: "Meeting Notes", desc: "Agendas, decisions, and action items.", icon: ClipboardList },
];

/** Integrations shown in the trust row. */
export const integrations: { name: string; icon: LucideIcon }[] = [
  { name: "Notion", icon: NotebookPen },
  { name: "Google Calendar", icon: CalendarDays },
  { name: "Gmail", icon: Mail },
  { name: "Slack", icon: MessageSquare },
  { name: "Stripe", icon: CreditCard },
  { name: "GitHub", icon: Github },
];

/** The onboarding → generation journey. */
export const steps = [
  {
    k: "01",
    title: "Answer 10 questions",
    desc: "Name, profession, goals, team, revenue, and the systems you need. Ninety seconds, tops.",
  },
  {
    k: "02",
    title: "LifeOS designs your system",
    desc: "The model maps your answers to the exact databases, relations, and views you'll actually use.",
  },
  {
    k: "03",
    title: "Your workspace builds itself",
    desc: "Databases, dashboards, templates, automations, and recurring tasks — written into Notion live.",
  },
  {
    k: "04",
    title: "Meet your assistant",
    desc: "A personalized AI that runs weekly reviews, daily summaries, and keeps everything in sync.",
  },
];

/** Feature bento. `span` maps to a 12-col grid arrangement. */
export const features: {
  title: string;
  desc: string;
  icon: LucideIcon;
  span: string;
  accent?: boolean;
}[] = [
  {
    title: "AI workspace generation",
    desc: "Not a template you fill in — a system designed around your answers, then written into Notion in real time.",
    icon: Sparkles,
    span: "lg:col-span-7",
    accent: true,
  },
  {
    title: "Relations & rollups, done right",
    desc: "Projects link to tasks, tasks to goals, goals to your week. The wiring that takes pros days — automatic.",
    icon: Boxes,
    span: "lg:col-span-5",
  },
  {
    title: "Calendar & inbox sync",
    desc: "Google Calendar, Apple Calendar, and Gmail flow into your planner and daily summary.",
    icon: CalendarDays,
    span: "lg:col-span-5",
  },
  {
    title: "Weekly AI reviews",
    desc: "Every Sunday, a written review: what shipped, what slipped, what to focus on next.",
    icon: Repeat,
    span: "lg:col-span-7",
  },
];

/** Pricing tiers. */
export const pricing: {
  id: string;
  name: string;
  price: number;
  cadence: string;
  tagline: string;
  features: string[];
  cta: string;
  featured?: boolean;
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: 19,
    cadence: "/mo",
    tagline: "For individuals getting organized.",
    features: [
      "Full workspace generation",
      "10 core databases",
      "Google & Apple Calendar sync",
      "Daily summaries",
      "1 workspace",
    ],
    cta: "Start free",
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    cadence: "/mo",
    tagline: "For operators running their whole life.",
    features: [
      "Everything in Starter",
      "CRM + Finance modules",
      "Weekly AI reviews",
      "Gmail, Slack & GitHub",
      "Voice assistant",
      "3 workspaces",
    ],
    cta: "Start free",
    featured: true,
  },
  {
    id: "founder",
    name: "Founder",
    price: 99,
    cadence: "/mo",
    tagline: "For founders and small teams.",
    features: [
      "Everything in Pro",
      "Team collaboration",
      "Custom automations",
      "Analytics & KPIs",
      "Priority generation",
      "Unlimited workspaces",
    ],
    cta: "Talk to us",
  },
];

export const testimonials: {
  quote: string;
  name: string;
  role: string;
}[] = [
  {
    quote:
      "I've paid consultants $4k to build me a Notion setup. LifeOS did something better in under a minute.",
    name: "Maya Chen",
    role: "Founder, Reforge alum",
  },
  {
    quote:
      "The relations alone would've taken me a weekend. It even set up my weekly review ritual.",
    name: "Daniel Okafor",
    role: "Head of Ops, Series B startup",
  },
  {
    quote:
      "It feels less like a template and more like someone who actually understood how I work.",
    name: "Priya Nair",
    role: "Independent designer",
  },
  {
    quote:
      "My whole team is on the same system now. Onboarding a new hire is one click.",
    name: "Tom Rivera",
    role: "Agency owner",
  },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "Do I need to already use Notion?",
    a: "No. If you have a Notion account we build directly into it. If you don't, we create one during onboarding and hand you the keys — you own everything.",
  },
  {
    q: "What exactly gets created?",
    a: "Up to 10 interconnected databases, dashboards, page templates, recurring tasks, automations, KPI rollups, and a personalized AI assistant — all wired with the right relations and views for your profile.",
  },
  {
    q: "Is it really under 60 seconds?",
    a: "Generation typically completes in 30–60 seconds. Complex team workspaces on the Founder plan can take up to two minutes.",
  },
  {
    q: "Can I edit everything afterward?",
    a: "Completely. LifeOS produces native Notion — no lock-in, no proprietary format. Rename, restructure, or delete anything. It's yours.",
  },
  {
    q: "How is my data handled?",
    a: "We request the minimum Notion scopes needed, store tokens encrypted, and never train models on your content. You can revoke access at any time.",
  },
  {
    q: "What if I don't like the result?",
    a: "Regenerate with different answers, or roll back. Every plan includes a 14-day money-back guarantee.",
  },
];
