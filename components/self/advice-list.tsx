"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlarmClock, BatteryLow, CalendarClock, Check, Clock, GitMerge, Layers, Lightbulb, ListChecks, Loader2, Target, UserRound, X, Zap,
} from "lucide-react";
import type { Advice, AdviceAction, AdviceKind } from "@/lib/self/advice";
import { fill, plural, type Locale } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type Messages = ReturnType<typeof useMessages>;

const ICON: Record<AdviceKind, typeof Target> = {
  commitment: CalendarClock,
  overdue: AlarmClock,
  "goal-stuck": Target,
  "energy-low": BatteryLow,
  tension: Zap,
  "step-stale": Clock,
  portrait: UserRound,
  overload: Layers,
  "idea-loose": Lightbulb,
};

/** "vendredi 2 octobre à 09:00" / "on Friday 2 October at 09:00", where they are — the day alone when no time was said. */
export function formatWhen(iso: string, locale: Locale, zone: string, withTime = true): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(d);
  if (!withTime) return locale === "fr" ? day : `on ${day}`;
  const time = new Intl.DateTimeFormat(locale, { hour: locale === "fr" ? "2-digit" : "numeric", minute: "2-digit", timeZone: zone }).format(d);
  return locale === "fr" ? `${day} à ${time}` : `on ${day} at ${time}`;
}

/** What a piece of advice says, in the reader's words, from what was found. */
export function adviceText(a: Advice, m: Messages, locale: Locale, zone: string): string {
  const t = m.self.advice;
  const f = a.facts;
  const num = (v: string | number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(v));
  switch (a.kind) {
    case "commitment":
      return fill(t.commitment, { title: String(f.title), when: formatWhen(String(f.at), locale, zone, f.timed === 1) });
    case "overdue":
      return fill(t.overdue, { title: String(f.title), when: formatWhen(String(f.at), locale, zone, f.timed === 1) });
    case "goal-stuck":
      return fill(t.goalStuck, { title: String(f.title) });
    case "energy-low":
      return fill(t.energyLow, { mean: num(f.mean), n: String(f.n) });
    case "tension":
      return fill(t.tension, { a: String(f.a), b: String(f.b) });
    case "step-stale":
      return fill(plural(locale, Number(f.days), t.stepStale), { title: String(f.title) });
    case "portrait":
      return plural(locale, Number(f.count), t.portrait);
    case "overload":
      return fill(t.overload, { open: String(f.open), unaligned: String(f.unaligned) });
    case "idea-loose":
      return fill(t.ideaLoose, { title: String(f.title) });
  }
}

export interface AdviceHandlers {
  /** Runs an action that stays on this page; resolves when done. */
  run: (advice: Advice, action: AdviceAction) => Promise<void>;
  /** Proposes next steps for a goal; the steps, or null if none could be proposed. */
  proposeSteps: (noteId: string) => Promise<string[] | null>;
  /** Adds the chosen steps to the goal. */
  adoptSteps: (advice: Advice, noteId: string, steps: string[]) => Promise<boolean>;
  setState: (advice: Advice, status: "dismissed" | "snoozed") => void;
}

function ActionButton({
  advice,
  action,
  handlers,
  zone,
  primary,
  onSteps,
}: {
  advice: Advice;
  action: AdviceAction;
  handlers: AdviceHandlers;
  zone: string;
  primary: boolean;
  onSteps: (steps: string[] | null) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.advice.act;
  const [busy, setBusy] = useState(false);
  const cls = cn(
    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[0.74rem] transition-colors disabled:opacity-50",
    primary ? "bg-foreground font-medium text-background" : "border border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
  );
  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const spinner = busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null;

  switch (action.type) {
    case "open":
      return (
        <Link href={`/brain?note=${encodeURIComponent(action.noteId)}`} className={cls}>
          {t.open}
        </Link>
      );
    case "decide":
      return (
        <Link href={`/brain?decide=${encodeURIComponent(action.linkId)}`} className={cls}>
          <Zap className="h-3 w-3" /> {t.decide}
        </Link>
      );
    case "steps-list":
      return (
        <Link href="/brain?region=next" className={cls}>
          <ListChecks className="h-3 w-3" /> {t.stepsList}
        </Link>
      );
    case "portrait":
      return (
        <a href="#portrait" className={cls}>
          <UserRound className="h-3 w-3" /> {t.portrait}
        </a>
      );
    case "steps":
      return (
        <button type="button" disabled={busy} className={cls} onClick={() => void go(async () => onSteps(await handlers.proposeSteps(action.noteId)))}>
          {spinner ?? <Target className="h-3 w-3" />} {t.steps}
        </button>
      );
    case "done":
      return (
        <button type="button" disabled={busy} className={cls} onClick={() => void go(() => handlers.run(advice, action))}>
          {spinner ?? <Check className="h-3 w-3" />} {t.done}
        </button>
      );
    case "remind":
      return (
        <button type="button" disabled={busy} className={cls} onClick={() => void go(() => handlers.run(advice, action))}>
          {spinner ?? <CalendarClock className="h-3 w-3" />} {fill(t.remind, { when: formatWhen(action.at, locale, zone) })}
        </button>
      );
    case "weave":
      return (
        <button type="button" disabled={busy} className={cls} onClick={() => void go(() => handlers.run(advice, action))}>
          {spinner ?? <GitMerge className="h-3 w-3" />} {t.weave}
        </button>
      );
  }
}

function AdviceCard({ advice, handlers, zone }: { advice: Advice; handlers: AdviceHandlers; zone: string }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.advice;
  const Icon = ICON[advice.kind];
  // Steps proposed for a goal, right here, to pick from.
  const [steps, setSteps] = useState<{ list: string[]; picked: Set<number> } | null>(null);
  const [adopting, setAdopting] = useState(false);
  const goalId = advice.actions.find((a): a is Extract<AdviceAction, { type: "steps" }> => a.type === "steps")?.noteId ?? null;

  return (
    <li className="rounded-lg border border-border bg-surface p-3.5">
      <div className="flex gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.86rem] leading-snug">{adviceText(advice, m, locale, zone)}</p>
          {steps ? (
            <div className="mt-2.5">
              <ul className="flex flex-col gap-1">
                {steps.list.map((s, i) => (
                  <li key={s}>
                    <label className="flex cursor-pointer items-start gap-2 text-[0.8rem] leading-snug">
                      <input
                        type="checkbox"
                        checked={steps.picked.has(i)}
                        onChange={() =>
                          setSteps((cur) => {
                            if (!cur) return cur;
                            const picked = new Set(cur.picked);
                            if (picked.has(i)) picked.delete(i);
                            else picked.add(i);
                            return { ...cur, picked };
                          })
                        }
                        className="mt-0.5 accent-[#0284c7]"
                      />
                      {s}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  disabled={adopting || steps.picked.size === 0 || !goalId}
                  onClick={async () => {
                    if (!goalId) return;
                    setAdopting(true);
                    const ok = await handlers.adoptSteps(advice, goalId, steps.list.filter((_, i) => steps.picked.has(i)));
                    setAdopting(false);
                    if (ok) setSteps(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[0.74rem] font-medium text-background disabled:opacity-40"
                >
                  {adopting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{" "}
                  {plural(locale, steps.picked.size, m.brain.develop.add)}
                </button>
                <button type="button" onClick={() => setSteps(null)} className="rounded-md px-2 py-1 text-[0.74rem] text-muted-foreground hover:text-foreground">
                  {m.brain.develop.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {advice.actions.map((a, i) => (
                <ActionButton
                  key={`${a.type}-${i}`}
                  advice={advice}
                  action={a}
                  handlers={handlers}
                  zone={zone}
                  primary={i === 0}
                  onSteps={(list) => setSteps(list && list.length ? { list, picked: new Set(list.map((_, k) => k)) } : null)}
                />
              ))}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => handlers.setState(advice, "snoozed")}
                className="rounded-md px-1.5 py-1 text-[0.7rem] text-muted-foreground hover:text-foreground"
              >
                {t.snooze}
              </button>
              <button
                type="button"
                onClick={() => handlers.setState(advice, "dismissed")}
                aria-label={t.dismiss}
                title={t.dismiss}
                className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function AdviceList({ advice, handlers, zone }: { advice: Advice[]; handlers: AdviceHandlers; zone: string }) {
  const m = useMessages();
  const t = m.self.advice;
  return (
    <section aria-labelledby="advice-title" className="rounded-xl border border-border bg-surface-2/20 p-5">
      <h2 id="advice-title" className="text-[0.95rem] font-medium">
        {t.title}
      </h2>
      <p className="mt-0.5 text-[0.74rem] text-muted-foreground">{t.hint}</p>
      {advice.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-[0.82rem] text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {advice.map((a) => (
            <AdviceCard key={a.key} advice={a} handlers={handlers} zone={zone} />
          ))}
        </ul>
      )}
    </section>
  );
}
