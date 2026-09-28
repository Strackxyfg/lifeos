import {
  LayoutDashboard, Boxes, Users, Wallet, Sparkles, Brain, Bot,
  Settings, CreditCard, Map,
  type LucideIcon,
} from "lucide-react";

export type NavId =
  | "hub" | "dashboard" | "projects" | "crm" | "finance"
  | "assistant" | "brain" | "agent" | "billing" | "settings";

export interface NavItem {
  id: NavId;
  href: string;
  icon: LucideIcon;
  hint?: string;
}

/** The product: the island it all starts from, the second brain, and the two ways of working from it. */
export const primaryNav: NavItem[] = [
  { id: "hub", href: "/hub", icon: Map, hint: "G H" },
  { id: "brain", href: "/brain", icon: Brain, hint: "G R" },
  { id: "assistant", href: "/assistant", icon: Sparkles, hint: "G A" },
  { id: "agent", href: "/agent", icon: Bot, hint: "G G" },
];

/** The rest of the activity it helps run. */
export const workNav: NavItem[] = [
  { id: "dashboard", href: "/dashboard", icon: LayoutDashboard, hint: "G D" },
  { id: "projects", href: "/projects", icon: Boxes, hint: "G P" },
  { id: "crm", href: "/crm", icon: Users, hint: "G C" },
  { id: "finance", href: "/finance", icon: Wallet, hint: "G F" },
];

export const secondaryNav: NavItem[] = [
  { id: "billing", href: "/billing", icon: CreditCard, hint: "G B" },
  { id: "settings", href: "/settings", icon: Settings, hint: "G S" },
];
