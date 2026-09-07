export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[1.75rem] font-medium tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
