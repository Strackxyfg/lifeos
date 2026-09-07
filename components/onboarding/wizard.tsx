"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { questions, type OnboardingAnswers } from "@/lib/onboarding";
import { completeOnboarding } from "@/app/actions/onboarding";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { Kbd } from "@/components/ui/kbd";

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>({ goals: [] });

  const q = questions[step];
  const progress = ((step + 1) / questions.length) * 100;

  const value = answers[q.id];
  const isValid = useMemo(() => {
    if (q.optional) return true;
    if (q.type === "multi") return Array.isArray(value) && value.length > 0;
    if (q.type === "boolean") return typeof value === "boolean";
    return value !== undefined && value !== "";
  }, [q, value]);

  const set = useCallback(
    (v: unknown) => setAnswers((a) => ({ ...a, [q.id]: v })),
    [q.id]
  );

  const finish = useCallback(
    async (finalAnswers: Partial<OnboardingAnswers>) => {
      try {
        sessionStorage.setItem("lifeos:onboarding", JSON.stringify(finalAnswers));
        // New answers → allow a fresh build (the generator refuses to re-run
        // for an onboarding it has already generated).
        sessionStorage.removeItem("lifeos:generated");
      } catch {}
      // Persist the display profile so the app is personalized on arrival.
      try {
        await completeOnboarding(finalAnswers);
      } catch {}
      router.push("/generate");
    },
    [router]
  );

  const next = useCallback(() => {
    if (!isValid) return;
    if (step === questions.length - 1) {
      finish(answers);
      return;
    }
    setDir(1);
    setStep((s) => s + 1);
  }, [isValid, step, answers, finish]);

  const back = () => {
    if (step === 0) return;
    setDir(-1);
    setStep((s) => s - 1);
  };

  const toggleMulti = (opt: string) => {
    const cur = (answers.goals as string[]) ?? [];
    set(cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]);
  };

  const selectAndAdvance = (v: unknown) => {
    setAnswers((a) => ({ ...a, [q.id]: v }));
    setTimeout(() => {
      if (step === questions.length - 1) {
        finish({ ...answers, [q.id]: v });
      } else {
        setDir(1);
        setStep((s) => s + 1);
      }
    }, 180);
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Progress */}
      <div className="fixed inset-x-0 top-0 z-10 h-0.5 bg-border">
        <motion.div
          className="h-full bg-accent"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease }}
        />
      </div>

      <header className="container flex max-w-content items-center justify-between py-6">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          LifeOS
        </span>
        <span className="font-mono text-[0.8125rem] text-muted-foreground">
          {String(step + 1).padStart(2, "0")} / {questions.length}
        </span>
      </header>

      <div className="container flex max-w-xl flex-1 flex-col justify-center py-12">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -24 }}
            transition={{ duration: 0.32, ease }}
          >
            <h1 className="text-h2 text-balance tracking-tight">{q.title}</h1>
            {q.subtitle && (
              <p className="mt-3 text-[0.9375rem] text-muted-foreground">{q.subtitle}</p>
            )}

            <div className="mt-8">
              {q.type === "text" && (
                <input
                  autoFocus
                  value={(value as string) ?? ""}
                  onChange={(e) => set(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && next()}
                  placeholder={q.placeholder}
                  className="w-full border-0 border-b border-border bg-transparent pb-3 text-2xl tracking-tight outline-none transition-colors placeholder:text-muted focus:border-accent"
                />
              )}

              {q.type === "single" && (
                <div className="grid gap-2">
                  {q.options!.map((opt) => (
                    <OptionRow
                      key={opt}
                      selected={value === opt}
                      onClick={() => selectAndAdvance(opt)}
                    >
                      {opt}
                    </OptionRow>
                  ))}
                </div>
              )}

              {q.type === "multi" && (
                <div className="flex flex-wrap gap-2">
                  {q.options!.map((opt) => {
                    const active = ((value as string[]) ?? []).includes(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => toggleMulti(opt)}
                        className={cn(
                          "rounded-lg border px-4 py-2.5 text-sm transition-all duration-200",
                          active
                            ? "border-accent/50 bg-accent/10 text-foreground"
                            : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground"
                        )}
                      >
                        {active && <Check className="mr-1.5 inline h-3.5 w-3.5 text-accent" />}
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === "boolean" && (
                <div className="grid grid-cols-2 gap-3">
                  {[["Yes", true], ["No", false]].map(([label, val]) => (
                    <OptionRow
                      key={String(label)}
                      selected={value === val}
                      onClick={() => selectAndAdvance(val)}
                      center
                    >
                      {label}
                    </OptionRow>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="container flex max-w-xl items-center justify-between py-8">
        <button
          onClick={back}
          disabled={step === 0}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-0"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {(q.type === "text" || q.type === "multi") && (
          <button
            onClick={next}
            disabled={!isValid}
            className="flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-[transform,opacity] duration-200 active:scale-[0.985] disabled:opacity-40"
          >
            Continue <Kbd className="border-background/20 bg-background/10 text-background/70">↵</Kbd>
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </footer>
    </div>
  );
}

function OptionRow({
  children,
  selected,
  onClick,
  center,
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  center?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex items-center justify-between rounded-lg border px-4 py-3.5 text-left text-[0.9375rem] transition-all duration-200",
        center && "justify-center",
        selected
          ? "border-accent/50 bg-accent/10"
          : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
      )}
    >
      <span>{children}</span>
      {!center && (
        <ArrowRight
          className={cn(
            "h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100",
            selected && "text-accent opacity-100"
          )}
        />
      )}
    </button>
  );
}
