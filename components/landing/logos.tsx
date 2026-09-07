import { Reveal } from "@/components/ui/reveal";
import { integrations } from "@/lib/content/site";

export function Logos() {
  return (
    <div className="border-y border-border bg-surface/20">
      <div className="container max-w-content py-10">
        <Reveal className="flex flex-col items-center gap-6">
          <p className="text-eyebrow uppercase text-muted">
            Connects the tools you already live in
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
            {integrations.map(({ name, icon: Icon }) => (
              <div
                key={name}
                className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium">{name}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </div>
  );
}
