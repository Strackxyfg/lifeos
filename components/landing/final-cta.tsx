"use client";

import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { buttonVariants } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * The closing call to action goes straight to sign-up, which works.
 *
 * It replaces a waitlist form that stored nothing: it waited 700 ms, then
 * told every visitor "You're on the list. Check your inbox" — no address was
 * kept and no email was ever sent — under a "2,400+ people already waiting"
 * counter that was also invented.
 */
export function FinalCta() {
  const t = useMessages().landing.cta;

  return (
    <section className="relative overflow-hidden py-32">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid mask-fade-b absolute inset-0 opacity-[0.25]" />
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[100px]" />
      </div>

      <div className="container max-w-content">
        <Reveal className="mx-auto flex max-w-xl flex-col items-center text-center">
          <h2 className="text-h1 text-balance text-gradient">{t.title}</h2>
          <p className="mt-5 max-w-md text-lead text-muted-foreground text-pretty">{t.lead}</p>
          <a href="/signup" className={cn(buttonVariants({ size: "lg" }), "group mt-9")}>
            {t.button}
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
