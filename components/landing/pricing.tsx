import { Check } from "lucide-react";
import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { pricing } from "@/lib/content/site";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Pricing() {
  return (
    <Section id="pricing">
      <Reveal>
        <SectionHeader
          eyebrow="Pricing"
          title="Priced like a tool. Worth a hire."
          description="Every plan includes full workspace generation and a 14-day money-back guarantee."
        />
      </Reveal>

      <RevealGroup className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-3">
        {pricing.map((tier) => (
          <RevealItem
            key={tier.id}
            className={cn(
              "relative flex flex-col rounded-xl border p-7",
              tier.featured
                ? "border-accent/40 bg-surface shadow-glow"
                : "border-border bg-surface"
            )}
          >
            {tier.featured && (
              <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-[0.6875rem] font-medium text-accent-foreground">
                Most popular
              </span>
            )}
            <h3 className="text-sm font-medium text-muted-foreground">{tier.name}</h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-4xl font-medium tracking-tight">${tier.price}</span>
              <span className="text-sm text-muted-foreground">{tier.cadence}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{tier.tagline}</p>

            <a
              href="#waitlist"
              className={cn(
                buttonVariants({ variant: tier.featured ? "accent" : "secondary", size: "md" }),
                "mt-6 w-full"
              )}
            >
              {tier.cta}
            </a>

            <ul className="mt-7 flex flex-col gap-3 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span className="text-foreground/85">{f}</span>
                </li>
              ))}
            </ul>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
