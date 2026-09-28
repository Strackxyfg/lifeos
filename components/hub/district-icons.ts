import { Bot, Boxes, Brain, CalendarClock, ChartLine, Handshake, Settings, Sparkles, UsersRound, type LucideIcon } from "lucide-react";
import type { DistrictId } from "@/lib/hub/districts";

/** The same pictograms as the buildings' signs (`lib/hub/glyphs.ts`), for the page. */
export const DISTRICT_ICONS: Record<DistrictId, LucideIcon> = {
  brain: Brain,
  today: CalendarClock,
  assistant: Sparkles,
  agent: Bot,
  projects: Boxes,
  relations: Handshake,
  finance: ChartLine,
  team: UsersRound,
  settings: Settings,
};
