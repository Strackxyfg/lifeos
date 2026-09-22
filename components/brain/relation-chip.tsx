"use client";

import { Bot, Sparkles } from "lucide-react";
import { RELATION_COLOR, type LinkOrigin, type Perspective, type RelationKind } from "@/lib/brain/relations";
import { relationText } from "@/lib/brain/labels";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** What a connection means, read from one note: "Moves forward", "Supported by"… */
export function RelationChip({
  kind,
  side,
  className,
}: {
  kind: RelationKind;
  side: Perspective;
  className?: string;
}) {
  const m = useMessages();
  const color = RELATION_COLOR[kind];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[0.66rem] font-medium", className)}
      style={{ borderColor: `${color}55`, background: `${color}14`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {relationText(kind, side, m)}
    </span>
  );
}

/** Marks a connection drawn by LifeOS or the agent that the person has not reviewed. */
export function UnreviewedBadge({ origin }: { origin: LinkOrigin }) {
  const m = useMessages();
  const Icon = origin === "agent" ? Bot : Sparkles;
  return (
    <span
      title={m.brain.review.badgeTitle}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-accent/40 px-1.5 py-px text-[0.62rem] font-medium text-accent"
    >
      <Icon className="h-2.5 w-2.5" /> {origin === "agent" ? m.brain.review.agent : m.brain.review.ai}
    </span>
  );
}
