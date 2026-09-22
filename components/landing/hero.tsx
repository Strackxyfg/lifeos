"use client";

import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { fadeUp, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMessages } from "@/lib/i18n/client";
import { BrainPreview } from "./brain-preview";

export function Hero() {
  const t = useMessages().landing.hero;

  return (
    <section className="relative overflow-hidden pb-24 pt-40">
      {/* Background: hairline grid + aurora, masked to fade downward */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid mask-fade-b absolute inset-0 opacity-[0.4]" />
        <div className="bg-aurora absolute inset-x-0 top-0 h-[560px]" />
      </div>

      <div className="container max-w-content">
        <motion.div
          variants={stagger(0.08, 0.05)}
          initial="hidden"
          animate="show"
          className="mx-auto flex max-w-3xl flex-col items-center text-center"
        >
          <motion.div variants={fadeUp}>
            <Badge dot>{t.badge}</Badge>
          </motion.div>

          <motion.h1 variants={fadeUp} className="mt-6 text-display text-balance text-gradient">
            {t.title}
          </motion.h1>

          <motion.p variants={fadeUp} className="mt-6 max-w-xl text-lead text-muted-foreground text-pretty">
            {t.lead}
          </motion.p>

          <motion.div variants={fadeUp} className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <a href="/signup" className={cn(buttonVariants({ size: "lg" }), "group")}>
              {t.primary}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
            <a href="#how" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              {t.secondary}
            </a>
          </motion.div>

          <motion.p variants={fadeUp} className="mt-5 flex items-center gap-2 text-[0.8125rem] text-muted">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t.foot}
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto mt-16 max-w-4xl"
        >
          <div className="absolute -inset-x-8 -top-8 bottom-0 -z-10 bg-aurora blur-2xl" />
          <div className="rounded-2xl border border-border bg-surface/40 p-2 shadow-lift backdrop-blur">
            <BrainPreview />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
