import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { features } from "@/lib/content/site";
import { cn } from "@/lib/utils";

export function Features() {
  return (
    <Section id="features">
      <Reveal>
        <SectionHeader
          eyebrow="Why it feels different"
          title="It doesn't hand you a template. It builds you a system."
          description="Every LifeOS workspace is generated from your answers — the structure, the relations, the rituals — not stamped from a mold."
        />
      </Reveal>

      <RevealGroup className="mt-16 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {features.map((f) => (
          <RevealItem
            key={f.title}
            className={cn(
              "group relative overflow-hidden rounded-xl border border-border bg-surface p-7 transition-colors hover:border-border-strong",
              f.span
            )}
          >
            {f.accent && (
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
            )}
            <div
              className={cn(
                "grid h-10 w-10 place-items-center rounded-lg border border-border",
                f.accent ? "bg-accent/10 text-accent" : "bg-surface-2 text-foreground"
              )}
            >
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-5 text-lg font-medium tracking-tight">{f.title}</h3>
            <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
              {f.desc}
            </p>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
