import {
  LayoutDashboard, Boxes, Users, Wallet, Sparkles, Brain, Bot,
  Settings, CreditCard,
  type LucideIcon,
} from "lucide-react";

export type NavId =
  | "dashboard" | "projects" | "crm" | "finance"
  | "assistant" | "brain" | "agent" | "billing" | "settings";

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
  { id: "assistant", href: "/assistant", icon: Sparkles, hint: "G A" },
  { id: "brain", href: "/brain", icon: Brain, hint: "G R" },
  { id: "agent", href: "/agent", icon: Bot, hint: "G G" },
];

export const secondaryNav: NavItem[] = [
  { id: "billing", href: "/billing", icon: CreditCard, hint: "G B" },
  { id: "settings", href: "/settings", icon: Settings, hint: "⌘," },
];
