import { cn } from "@/lib/utils";

/** Consistent vertical rhythm + 12-col container for marketing sections. */
export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("py-24 sm:py-32", className)}>
      <div className="container max-w-content">{children}</div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start text-left"
      )}
    >
      {eyebrow && (
        <span className="text-eyebrow uppercase text-accent">{eyebrow}</span>
      )}
      <h2 className="text-h2 max-w-2xl text-balance text-gradient">{title}</h2>
      {description && (
        <p className="max-w-prose text-lead text-muted-foreground text-pretty">
          {description}
        </p>
      )}
    </div>
  );
}
