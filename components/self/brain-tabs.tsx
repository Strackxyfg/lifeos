"use client";

import Link from "next/link";
import { Brain, UserRound, Waypoints } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { TabStrip } from "@/components/ui/tab-strip";

/**
 * The brain, its double and its maps: three faces of the same section. On a
 * narrow screen the row scrolls on its own rather than pushing the page
 * sideways (`TabStrip`).
 */
export function BrainTabs({ active, badge }: { active: "brain" | "double" | "maps"; badge?: number }) {
  const m = useMessages();
  const tab = (id: "brain" | "double" | "maps", href: string, label: string, Icon: typeof Brain) => (
    <Link
      href={href}
      aria-current={active === id ? "page" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[0.8125rem] transition-colors [@media(pointer:coarse)]:py-2",
        active === id ? "bg-surface-2 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {id === "double" && badge ? (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[0.6rem] text-background">{badge}</span>
      ) : null}
    </Link>
  );
  return (
    <nav aria-label={m.self.title} className="mb-5 flex">
      <TabStrip activeKey={active} className="max-w-full rounded-lg border border-border bg-surface p-1" scrollerClassName="gap-1">
        {tab("brain", "/brain", m.self.tabs.brain, Brain)}
        {tab("double", "/brain/double", m.self.tabs.double, UserRound)}
        {tab("maps", "/brain/maps", m.maps.tab, Waypoints)}
      </TabStrip>
    </nav>
  );
}
