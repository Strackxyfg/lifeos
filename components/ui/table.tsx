import { cn } from "@/lib/utils";

/** Lightweight, premium table primitives — hairline rows, quiet headers. */
export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface-2/40 text-left text-[0.7rem] uppercase tracking-wider text-muted">
      {children}
    </thead>
  );
}

export function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}

export function Tr({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <tr className={cn("border-b border-border last:border-0 transition-colors hover:bg-surface-2/40", className)}>
      {children}
    </tr>
  );
}

export function Td({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}
