"use client";

import { Check } from "lucide-react";
import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * The same plans, prices and features as the billing page — one source, in
 * the dictionary. The landing page used to carry its own list, which promised
 * calendar sync, Gmail, Slack and GitHub integrations, team collaboration and
 * a money-back guarantee, none of which existed.
 */
export function Pricing() {
  const m = useMessages();
  const locale = useLocale();
  const t = m.landing.pricing;

  return (
    <Section id="pricing">
      <Reveal>
        <SectionHeader eyebrow={t.eyebrow} title={t.title} description={t.description} />
      </Reveal>

      <RevealGroup className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-3">
        {m.pricing.plans.map((plan) => {
          const featured = "featured" in plan && plan.featured;
          return (
            <RevealItem
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-xl border p-7",
                featured ? "border-accent/40 bg-surface shadow-glow" : "border-border bg-surface"
              )}
            >
              {featured && (
                <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-[0.6875rem] font-medium text-accent-foreground">
                  {t.featured}
                </span>
              )}
              <h3 className="text-sm font-medium text-muted-foreground">{plan.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-medium tracking-tight">{formatCurrency(plan.price, locale)}</span>
                <span className="text-sm text-muted-foreground">{m.pricing.perMonth}</span>
              </div>
              {/* Two lines reserved, so every plan's button sits at the same height. */}
              <p className="mt-2 text-sm text-muted-foreground lg:min-h-10">{plan.tagline}</p>
              <p className="mt-1 text-[0.78rem] text-success">{m.pricing.earlyAccess}</p>

              <a
                href="/signup"
                className={cn(buttonVariants({ variant: featured ? "accent" : "secondary", size: "md" }), "mt-6 w-full")}
              >
                {t.cta}
              </a>

              <ul className="mt-7 flex flex-col gap-3 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span className="text-foreground/85">{f}</span>
                  </li>
                ))}
              </ul>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </Section>
  );
}
