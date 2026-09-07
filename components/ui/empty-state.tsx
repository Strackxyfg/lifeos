import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Quiet, centred placeholder for a collection with no rows yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {Icon && (
        <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface-2 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="text-[0.9375rem] font-medium tracking-tight">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-xs text-[0.8125rem] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
