"use client";

import { motion } from "framer-motion";
import { ArrowRight, Clock } from "lucide-react";
import { fadeUp, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkspacePreview } from "./workspace-preview";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-40 pb-24">
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
            <Badge dot>Generating workspaces in under 60 seconds</Badge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="mt-6 text-display text-balance text-gradient"
          >
            Your entire life, organized in&nbsp;60&nbsp;seconds.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mt-6 max-w-xl text-lead text-muted-foreground text-pretty"
          >
            Answer 10 questions. LifeOS designs and builds a complete Notion
            workspace — databases, dashboards, automations and a personal AI
            assistant — tailored to exactly how you work.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
          >
            <a href="#waitlist" className={cn(buttonVariants({ size: "lg" }), "group")}>
              Get early access
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
            <a href="#product" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              See it build a workspace
            </a>
          </motion.div>

          <motion.p
            variants={fadeUp}
            className="mt-5 flex items-center gap-2 text-[0.8125rem] text-muted"
          >
            <Clock className="h-3.5 w-3.5" />
            No credit card · 14-day guarantee · You own everything
          </motion.p>
        </motion.div>

        {/* Framed product preview */}
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto mt-16 max-w-4xl"
        >
          <div className="absolute -inset-x-8 -top-8 bottom-0 -z-10 bg-aurora blur-2xl" />
          <div className="rounded-2xl border border-border bg-surface/40 p-2 shadow-lift backdrop-blur">
            <WorkspacePreview />
          </div>
          <div className="absolute -right-3 -top-3 hidden rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.75rem] shadow-card sm:block">
            <span className="text-muted-foreground">Generated in </span>
            <span className="font-mono text-accent">47s</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
