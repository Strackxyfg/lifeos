"use client";

import { Bot, Brain, FileDown, Sparkles, type LucideIcon } from "lucide-react";
import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Layout of the four cards on the 12-column grid, in dictionary order. */
const LAYOUT: { icon: LucideIcon; span: string; accent?: boolean }[] = [
  { icon: Brain, span: "lg:col-span-7", accent: true },
  { icon: Sparkles, span: "lg:col-span-5" },
  { icon: Bot, span: "lg:col-span-5" },
  { icon: FileDown, span: "lg:col-span-7" },
];

export function Features() {
  const t = useMessages().landing.features;

  return (
    <Section id="features">
      <Reveal>
        <SectionHeader eyebrow={t.eyebrow} title={t.title} description={t.description} />
      </Reveal>

      <RevealGroup className="mt-16 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {t.items.map((f, i) => {
          const { icon: Icon, span, accent } = LAYOUT[i % LAYOUT.length];
          return (
            <RevealItem
              key={f.title}
              className={cn(
                "group relative overflow-hidden rounded-xl border border-border bg-surface p-7 transition-colors hover:border-border-strong",
                span
              )}
            >
              {accent && (
                <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
              )}
              <div
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-lg border border-border",
                  accent ? "bg-accent/10 text-accent" : "bg-surface-2 text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-medium tracking-tight">{f.title}</h3>
              <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">{f.desc}</p>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <Reveal>
        <p className="mt-8 text-center text-[0.9375rem] text-muted-foreground">{t.more}</p>
      </Reveal>
    </Section>
  );
}
