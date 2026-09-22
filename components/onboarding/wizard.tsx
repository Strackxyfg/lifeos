"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Brain, Check, Loader2, Sparkles } from "lucide-react";

import { AREA_IDS, questions, type AreaId, type OnboardingDraft, type Question } from "@/lib/onboarding";
import { completeOnboarding, type OnboardingResult } from "@/app/actions/onboarding";
import { weaveNotes } from "@/app/actions/weave";
import { RelationChip } from "@/components/brain/relation-chip";
import { perspective } from "@/lib/brain/relations";
import type { BrainLink } from "@/lib/brain/graph";
import { categoryById } from "@/lib/data/brain";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { Kbd } from "@/components/ui/kbd";

type Done = Extract<OnboardingResult, { ok: true }>;
type ErrorCode = Extract<OnboardingResult, { ok: false }>["code"];

/**
 * The draft survives a reload and a trip through sign-in (same tab only —
 * sessionStorage is cleared when the tab closes). Without it, a session that
 * expired on the last question sent the person back to question one.
 */
const DRAFT_KEY = "lifeos:onboarding-draft";

const TEXT_IDS = ["name", "profession", "goal", "step", "goal2", "mind"] as const;

/** Keeps only well-typed fields from a stored draft: it is user-controlled input. */
function sanitizeDraft(raw: unknown): {
  answers: OnboardingDraft;
  step: number;
} {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (src.answers && typeof src.answers === "object" ? src.answers : {}) as Record<string, unknown>;
  const answers: OnboardingDraft = {};
  for (const id of TEXT_IDS) if (typeof a[id] === "string") answers[id] = a[id] as string;
  if (Array.isArray(a.areas)) {
    answers.areas = a.areas.filter((x): x is AreaId => (AREA_IDS as readonly string[]).includes(x as string));
  }
  const step = Number.isInteger(src.step) ? Math.min(Math.max(src.step as number, 0), questions.length - 1) : 0;
  return { answers, step };
}

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "");

export function OnboardingWizard({ initial }: { initial: OnboardingDraft }) {
  const m = useMessages();
  const t = m.onboarding;
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [answers, setAnswers] = useState<OnboardingDraft>(() => ({
    areas: [],
    ...initial,
  }));
  const [phase, setPhase] = useState<"asking" | "building" | "done">("asking");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  // Synchronous guard: a double click fires twice before any state update lands.
  const submitting = useRef(false);
  const restored = useRef(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = sanitizeDraft(JSON.parse(raw));
        setAnswers((a) => ({ ...a, ...draft.answers }));
        setStep(draft.step);
      }
    } catch {}
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current || phase === "done") return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ answers, step }));
    } catch {}
  }, [answers, step, phase]);

  const q = questions[step];
  const value = answers[q.id];
  const last = step === questions.length - 1;
  const canContinue = q.optional || filled(value);
  const progress = phase === "asking" ? (step / questions.length) * 100 : 100;

  const set = useCallback((id: Question["id"], v: string | AreaId[]) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setError(null);
  }, []);

  const finish = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPhase("building");
    setError(null);
    try {
      const res = await completeOnboarding(answers);
      if (res.ok) {
        setResult(res);
        setPhase("done");
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
      } else {
        setError(res.code);
        setPhase("asking");
      }
    } catch {
      // The action itself never throws; this is the network.
      setError("failed");
      setPhase("asking");
    } finally {
      submitting.current = false;
    }
  }, [answers]);

  const next = useCallback(() => {
    if (!canContinue || phase !== "asking") return;
    if (last) return void finish();
    setDir(1);
    setStep((s) => s + 1);
  }, [canContinue, phase, last, finish]);

  const back = () => {
    if (step === 0 || phase !== "asking") return;
    setDir(-1);
    setStep((s) => s - 1);
  };

  const toggleArea = (id: AreaId) => {
    const cur = answers.areas ?? [];
    set("areas", cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const copy = t.q[q.id];
  // The areas question is a set of chips, with nothing to type.
  const placeholder = "placeholder" in copy ? copy.placeholder : undefined;

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="fixed inset-x-0 top-0 z-10 h-0.5 bg-border" aria-hidden>
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
        {phase === "asking" && (
          <span className="font-mono text-[0.8125rem] text-muted-foreground" aria-live="polite">
            {String(step + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}
          </span>
        )}
      </header>

      <main className="container flex max-w-xl flex-1 flex-col justify-center py-10">
        {phase === "done" && result ? (
          <Summary
            result={result}
            name={(answers.name ?? "").trim().split(/\s+/)[0] ?? ""}
            onOpen={() => router.push("/brain")}
          />
        ) : phase === "building" ? (
          <div className="flex flex-col items-center text-center" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <p className="mt-4 text-[0.9375rem] text-muted-foreground">{t.building}</p>
          </div>
        ) : (
          // Enter animation only, deliberately. With an exit animation the
          // previous question's input stayed mounted — and focused — until
          // it finished, so whatever was typed right after Enter was added
          // to the previous answer. The new question now mounts, and takes
          // focus, immediately.
          <motion.div
            key={step}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28, ease }}
          >
            {q.optional && <p className="mb-2 text-[0.72rem] uppercase tracking-wider text-muted">{t.optional}</p>}
            <h1 className="text-h2 text-balance tracking-tight">
              {fill(copy.title, { goal: (answers.goal ?? "").trim() })}
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">{copy.subtitle}</p>

            <div className="mt-8">
              {q.type === "text" && (
                <input
                  autoFocus
                  value={(value as string) ?? ""}
                  maxLength={q.max}
                  onChange={(e) => set(q.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      next();
                    }
                  }}
                  placeholder={placeholder}
                  aria-label={copy.title}
                  className="w-full border-0 border-b border-border bg-transparent pb-3 text-2xl tracking-tight outline-none transition-colors placeholder:text-muted focus:border-accent"
                />
              )}

              {q.id === "profession" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {t.professionSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => set("profession", s)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[0.8125rem] transition-colors",
                        value === s
                          ? "border-accent/50 bg-accent/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {q.type === "longtext" && (
                <>
                  <textarea
                    autoFocus
                    rows={5}
                    value={(value as string) ?? ""}
                    maxLength={q.max}
                    onChange={(e) => set(q.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        next();
                      }
                    }}
                    placeholder={placeholder}
                    aria-label={copy.title}
                    className="w-full resize-none rounded-lg border border-border bg-surface/60 p-4 text-[0.9375rem] leading-relaxed outline-none transition-colors placeholder:text-muted focus:border-accent"
                  />
                  <p className="mt-2 text-[0.75rem] text-muted-foreground">{t.newLineHint}</p>
                </>
              )}

              {q.type === "multi" && (
                <div className="flex flex-wrap gap-2">
                  {AREA_IDS.map((id) => {
                    const active = (answers.areas ?? []).includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleArea(id)}
                        className={cn(
                          "rounded-lg border px-4 py-2.5 text-sm transition-all duration-200",
                          active
                            ? "border-accent/50 bg-accent/10 text-foreground"
                            : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground"
                        )}
                      >
                        {active && <Check className="mr-1.5 inline h-3.5 w-3.5 text-accent" />}
                        {t.areas[id]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[0.8125rem] text-danger"
              >
                {t.errors[error]}
                {error === "unauthorized" && (
                  <>
                    {" "}
                    <Link href="/login?next=/onboarding" className="font-medium underline underline-offset-4">
                      {t.signIn}
                    </Link>
                  </>
                )}
              </div>
            )}
          </motion.div>
        )}
      </main>

      {phase === "asking" && (
        <footer className="container flex max-w-xl items-center justify-between py-8">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-0"
          >
            <ArrowLeft className="h-4 w-4" /> {t.back}
          </button>

          <button
            type="button"
            onClick={next}
            disabled={!canContinue}
            className={cn(
              "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-[transform,opacity] duration-200 active:scale-[0.985] disabled:opacity-40",
              q.optional && !filled(value) && !last
                ? "border border-border bg-surface text-foreground"
                : "bg-foreground text-background"
            )}
          >
            {last ? (error ? t.retry : t.finish) : q.optional && !filled(value) ? t.skip : t.continue}
            {q.type === "text" && filled(value) && (
              <Kbd className="border-background/20 bg-background/10 text-background/70">↵</Kbd>
            )}
            <ArrowRight className="h-4 w-4" />
          </button>
        </footer>
      )}
    </div>
  );
}

function Summary({ result, name, onOpen }: { result: Done; name: string; onOpen: () => void }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.onboarding;

  // The first thing the brain does with what was just written: connect it.
  // Shown as it happens; if there is no model, or it finds nothing, or it
  // fails, this simply stays out of the way — the brain is built either way.
  const [woven, setWoven] = useState<{ phase: "running" | "done"; links: BrainLink[] }>({ phase: "running", links: [] });
  // One call, kept across remounts: React may mount an effect twice, and a
  // second weaving run finds everything already connected — it would replace
  // the real result with "nothing found".
  const run = useRef<ReturnType<typeof weaveNotes> | null>(null);
  useEffect(() => {
    let alive = true;
    run.current ??= weaveNotes(result.notes.map((n) => n.id).slice(0, 20));
    run.current
      .then((res) => alive && setWoven({ phase: "done", links: res.ok ? res.data.created : [] }))
      .catch(() => alive && setWoven({ phase: "done", links: [] }));
    return () => {
      alive = false;
    };
  }, [result]);
  const titleOf = new Map(result.notes.map((n) => [n.id, n.title]));

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
      <span className="grid h-12 w-12 place-items-center rounded-xl border border-accent/30 bg-accent/10">
        <Brain className="h-5 w-5 text-accent" />
      </span>
      <h1 className="mt-6 text-h2 text-balance tracking-tight">
        {name ? fill(t.doneTitle, { name }) : t.doneTitleNoName}
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
        {plural(locale, result.notes.length, t.doneNotes)}
        {result.linked > 0 && ` · ${t.doneLinked}`}
      </p>

      <ul className="mt-6 flex flex-col gap-1.5">
        {result.notes.map((n) => {
          const c = categoryById(n.category);
          return (
            <li
              key={`${n.category}:${n.title}`}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface/60 px-3.5 py-2.5"
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.875rem] leading-snug">{n.title}</span>
                <span className="block text-[0.72rem] text-muted-foreground">
                  {m.brain.cat[n.category].label}
                  {!n.isNew && ` · ${t.kept}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      {woven.phase === "running" ? (
        <p className="mt-4 flex items-center gap-2 text-[0.8125rem] text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> {t.weaving}
        </p>
      ) : woven.links.length > 0 ? (
        <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className="mt-4">
          <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" /> {plural(locale, woven.links.length, t.woven)}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {woven.links.map((l) => {
              const first = l.sourceId ?? l.fromId;
              const second = first === l.fromId ? l.toId : l.fromId;
              return (
                <li key={l.id} className="rounded-lg border border-dashed border-accent/30 px-3.5 py-2.5 text-[0.8125rem] leading-snug">
                  <span>{titleOf.get(first)}</span>{" "}
                  <RelationChip kind={l.kind} side={perspective(l.kind, first, l.sourceId)} className="mx-1 align-middle" />{" "}
                  <span>{titleOf.get(second)}</span>
                  {l.reason && <span className="mt-1 block text-[0.72rem] text-muted-foreground">{l.reason}</span>}
                </li>
              );
            })}
          </ul>
        </motion.section>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        autoFocus
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-transform duration-200 active:scale-[0.985]"
      >
        {t.open} <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-4 text-center text-[0.75rem] leading-relaxed text-muted-foreground">
        {t.notionAside}{" "}
        <Link href="/settings#connections" className="underline underline-offset-4 hover:text-foreground">
          {t.notionAsideLink}
        </Link>
      </p>
    </motion.div>
  );
}
