"use client";

import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { useMessages } from "@/lib/i18n/client";

export function HowItWorks() {
  const t = useMessages().landing.how;

  return (
    <Section id="how">
      <Reveal>
        <SectionHeader eyebrow={t.eyebrow} title={t.title} description={t.description} />
      </Reveal>

      <RevealGroup className="mt-16 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
        {t.steps.map((s, i) => (
          <RevealItem key={s.title} className="group flex flex-col bg-surface p-6 transition-colors hover:bg-surface-2">
            <span className="font-mono text-sm text-accent">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-4 text-[1.0625rem] font-medium tracking-tight">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
