"use client";

import Link from "next/link";
import { Brain, UserRound } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** The brain and its double: two faces of the same section. */
export function BrainTabs({ active, badge }: { active: "brain" | "double"; badge?: number }) {
  const m = useMessages();
  const tab = (id: "brain" | "double", href: string, label: string, Icon: typeof Brain) => (
    <Link
      href={href}
      aria-current={active === id ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[0.8125rem] transition-colors",
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
    <nav aria-label={m.self.title} className="mb-5 inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      {tab("brain", "/brain", m.self.tabs.brain, Brain)}
      {tab("double", "/brain/double", m.self.tabs.double, UserRound)}
    </nav>
  );
}
