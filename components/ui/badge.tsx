import * as React from "react";
import { cn } from "@/lib/utils";

/** Quiet, hairline pill used for eyebrows and status. */
export function Badge({
  className,
  children,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1",
        "text-[0.75rem] font-medium tracking-wide text-muted-foreground backdrop-blur",
        className
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-glow" />}
      {children}
    </span>
  );
}
