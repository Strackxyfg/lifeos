"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, FlaskConical, SlidersHorizontal, ShieldCheck } from "lucide-react";
import { items, ATTENTION_CHECK, type Item } from "@/lib/assessment/instrument";
import { submitAssessment } from "@/app/actions/assessment";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

const PER_PAGE = 5;

/** Attention check sits mid-way, where straight-lining usually sets in. */
function buildSequence(): Item[] {
  const all = [...items];
  const mid = Math.floor(all.length / 2);
  return [...all.slice(0, mid), ATTENTION_CHECK, ...all.slice(mid)];
}

export function AssessmentFlow() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const sequence = useMemo(buildSequence, []);
  const pages = Math.ceil(sequence.length / PER_PAGE);

  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();

  const slice = sequence.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const pageComplete = slice.every((i) => typeof answers[i.id] === "number");
  const answered = Object.keys(answers).length;
  const progress = Math.round((answered / sequence.length) * 100);
  const isLast = page === pages - 1;

  const scale = [
    m.assessment.veryInaccurate,
    m.assessment.inaccurate,
    m.assessment.neutral,
    m.assessment.accurate,
    m.assessment.veryAccurate,
  ];

  const next = () => {
    if (!pageComplete) return;
    if (!isLast) {
      setPage((p) => p + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    start(async () => {
      const res = await submitAssessment(answers);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast(res.valid ? m.assessment.savedValid : m.assessment.savedInvalid, res.valid ? "success" : "error");
      router.push("/agent");
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress */}
      <div className="sticky top-14 z-10 -mx-4 bg-background/85 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="flex items-center justify-between text-[0.75rem] text-muted-foreground">
          <span>{m.assessment.progress} {answered}/{sequence.length}</span>
          <span className="font-mono">{progress}%</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
          <motion.div
            className="h-full rounded-full bg-accent"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.35, ease }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease }}
          className="mt-6 space-y-3"
        >
          {slice.map((item) => (
            <fieldset key={item.id} className="rounded-xl border border-border bg-surface p-5">
              <legend className="sr-only">{locale === "fr" ? item.fr : item.en}</legend>

              <div className="mb-4 flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md",
                    item.module === "bigfive"
                      ? "bg-accent/10 text-accent"
                      : "bg-surface-2 text-muted-foreground"
                  )}
                  title={item.module === "bigfive" ? m.assessment.validatedTip : m.assessment.calibrationTip}
                >
                  {item.module === "bigfive" ? (
                    <FlaskConical className="h-3 w-3" />
                  ) : (
                    <SlidersHorizontal className="h-3 w-3" />
                  )}
                </span>
                <p className="text-[0.9375rem] leading-snug">
                  {locale === "fr" ? item.fr : item.en}
                </p>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {scale.map((label, idx) => {
                  const value = idx + 1;
                  const active = answers[item.id] === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setAnswers((a) => ({ ...a, [item.id]: value }))}
                      className={cn(
                        "rounded-lg border px-1 py-2.5 text-[0.7rem] leading-tight transition-all duration-200",
                        active
                          ? "border-accent/50 bg-accent/10 text-foreground"
                          : "border-border bg-surface-2/40 text-muted-foreground hover:border-border-strong hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || pending}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-0"
        >
          <ArrowLeft className="h-4 w-4" /> {m.assessment.back}
        </button>

        <button
          onClick={next}
          disabled={!pageComplete || pending}
          className={cn(buttonVariants({ size: "lg" }), "gap-2")}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isLast ? m.assessment.finish : m.assessment.next}
          {!pending && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>

      <p className="mt-6 flex items-start gap-2 text-[0.75rem] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {m.assessment.disclaimer}
      </p>
    </div>
  );
}
