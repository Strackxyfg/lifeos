"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Presentational switch.
 *
 * Uses `inline-flex items-center` + symmetric padding rather than absolute
 * offsets: the border participates in the box, so hand-tuned `top`/`translate`
 * values drift off-centre. Track 40×24 with a 1px border leaves 38×22 inside;
 * 3px of padding centres the 16px knob exactly and gives it 16px of travel.
 */
export function SwitchTrack({
  on,
  pending,
  className,
}: {
  on: boolean;
  pending?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-10 shrink-0 items-center rounded-full border px-[3px]",
        "transition-colors duration-200",
        on ? "border-accent/50 bg-accent" : "border-border bg-surface-2",
        pending && "opacity-70",
        className
      )}
    >
      <span
        className={cn(
          "h-4 w-4 rounded-full transition-transform duration-200 ease-premium",
          on ? "translate-x-4 bg-accent-foreground" : "translate-x-0 bg-foreground"
        )}
      />
    </span>
  );
}

/** Uncontrolled switch for static forms. */
export function Switch({
  defaultChecked = false,
  label,
}: {
  defaultChecked?: boolean;
  label?: string;
}) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => setOn((v) => !v)}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SwitchTrack on={on} />
    </button>
  );
}
