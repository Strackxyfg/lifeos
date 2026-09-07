import {
  LayoutDashboard, Boxes, Users, Wallet, Sparkles, Brain, Bot,
  BarChart3, Settings, CreditCard, UsersRound,
  type LucideIcon,
} from "lucide-react";

export type NavId =
  | "dashboard" | "projects" | "crm" | "finance" | "analytics"
  | "assistant" | "brain" | "agent" | "team" | "billing" | "settings";

export interface NavItem {
  id: NavId;
  href: string;
  icon: LucideIcon;
  hint?: string;
}

export const primaryNav: NavItem[] = [
  { id: "dashboard", href: "/dashboard", icon: LayoutDashboard, hint: "G D" },
  { id: "projects", href: "/projects", icon: Boxes, hint: "G P" },
  { id: "crm", href: "/crm", icon: Users, hint: "G C" },
  { id: "finance", href: "/finance", icon: Wallet, hint: "G F" },
  { id: "analytics", href: "/analytics", icon: BarChart3, hint: "G N" },
  { id: "assistant", href: "/assistant", icon: Sparkles, hint: "G A" },
  { id: "brain", href: "/brain", icon: Brain, hint: "G R" },
  { id: "agent", href: "/agent", icon: Bot, hint: "G G" },
];

export const secondaryNav: NavItem[] = [
  { id: "team", href: "/team", icon: UsersRound, hint: "G T" },
  { id: "billing", href: "/billing", icon: CreditCard, hint: "G B" },
  { id: "settings", href: "/settings", icon: Settings, hint: "⌘," },
];
