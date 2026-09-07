import { cn } from "@/lib/utils";

/** Raycast-style keyboard hint. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-border-strong",
        "bg-surface-2 px-1.5 font-mono text-[0.6875rem] font-medium text-muted-foreground",
        className
      )}
    >
      {children}
    </kbd>
  );
}
