import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { steps } from "@/lib/content/site";

export function HowItWorks() {
  return (
    <Section id="how">
      <Reveal>
        <SectionHeader
          eyebrow="How it works"
          title="From ten questions to a working system"
          description="No templates to wrangle. No blank pages. Just answers in, a complete operating system out."
        />
      </Reveal>

      <RevealGroup className="mt-16 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <RevealItem
            key={s.k}
            className="group flex flex-col bg-surface p-6 transition-colors hover:bg-surface-2"
          >
            <span className="font-mono text-sm text-accent">{s.k}</span>
            <h3 className="mt-4 text-[1.0625rem] font-medium tracking-tight">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
