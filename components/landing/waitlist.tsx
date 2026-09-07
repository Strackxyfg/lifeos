"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { joinWaitlist, type WaitlistState } from "@/app/actions/waitlist";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

const initial: WaitlistState = { ok: false, message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-12 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-[transform,filter] duration-200 hover:brightness-95 active:scale-[0.985] disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Get early access"}
      {!pending && <ArrowRight className="h-4 w-4" />}
    </button>
  );
}

export function Waitlist() {
  const [state, formAction] = useActionState(joinWaitlist, initial);

  return (
    <section id="waitlist" className="relative overflow-hidden py-32">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid mask-fade-b absolute inset-0 opacity-[0.25]" />
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[100px]" />
      </div>

      <div className="container max-w-content">
        <Reveal className="mx-auto flex max-w-xl flex-col items-center text-center">
          <h2 className="text-h1 text-balance text-gradient">
            Build your operating system tonight.
          </h2>
          <p className="mt-5 max-w-md text-lead text-muted-foreground text-pretty">
            Join the waitlist for early access. First cohort onboards this month.
          </p>

          <div className="mt-9 w-full max-w-md">
            <AnimatePresence mode="wait">
              {state.ok ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease }}
                  className="flex items-center justify-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3.5 text-sm text-success"
                >
                  <Check className="h-4 w-4" />
                  {state.message}
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  action={formAction}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col gap-2 sm:flex-row"
                >
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="you@work.com"
                    aria-label="Email address"
                    className="h-12 flex-1 rounded-lg border border-border bg-surface px-4 text-sm outline-none transition-colors placeholder:text-muted focus:border-border-strong focus:ring-2 focus:ring-ring/60"
                  />
                  <SubmitButton />
                </motion.form>
              )}
            </AnimatePresence>
            {!state.ok && state.message && (
              <p className={cn("mt-2 text-left text-[0.8125rem] text-danger")}>{state.message}</p>
            )}
          </div>

          <p className="mt-4 text-[0.8125rem] text-muted">
            2,400+ people already waiting · No spam, ever
          </p>
        </Reveal>
      </div>
    </section>
  );
}
