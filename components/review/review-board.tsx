"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, History, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { browserZone } from "@/lib/reminders/format";
import { addDays, weekFacts, weekStartOf } from "@/lib/review/week";
import { saveReview } from "@/app/actions/founder";
import type { ReviewDecision } from "@/lib/db/types";
import { money } from "@/components/finance/treasury";

export interface ReviewData {
  notes: { id: string; title: string; createdAt: string }[];
  reminders: { title: string; doneAt: string | null }[];
  transactions: { type: "Income" | "Expense"; amount: number; occurredOn: string | null }[];
  deals: { name: string; createdAt: string }[];
  reviews: { weekStart: string; wins: string; blockers: string; lessons: string; focus: string; decisions: ReviewDecision[] }[];
}

/** An instant, as a day of the person's own calendar. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14);
}

const field = "w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-border-strong";

export function ReviewBoard({ data, enabled }: { data: ReviewData; enabled: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const r = m.founder.review;
  const router = useRouter();
  const [pending, start] = useTransition();
  // The person's "this week" is only known in their browser.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localDay(new Date().toISOString())), []);
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => {
    if (today && !week) setWeek(weekStartOf(today));
  }, [today, week]);

  const existing = useMemo(() => data.reviews.find((x) => x.weekStart === week) ?? null, [data.reviews, week]);
  const [wins, setWins] = useState("");
  const [blockers, setBlockers] = useState("");
  const [lessons, setLessons] = useState("");
  const [focus, setFocus] = useState("");
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  useEffect(() => {
    setWins(existing?.wins ?? "");
    setBlockers(existing?.blockers ?? "");
    setLessons(existing?.lessons ?? "");
    setFocus(existing?.focus ?? "");
    setDecisions(existing?.decisions ?? []);
  }, [existing, week]);

  const facts = useMemo(() => {
    if (!week) return null;
    return weekFacts(
      {
        notes: data.notes.map((n) => ({ id: n.id, title: n.title, day: localDay(n.createdAt) })),
        remindersDone: data.reminders.filter((x) => x.doneAt).map((x) => ({ title: x.title, day: localDay(x.doneAt!) })),
        transactions: data.transactions.map((t) => ({ type: t.type, amount: t.amount, day: t.occurredOn })),
        deals: data.deals.map((d) => ({ name: d.name, day: localDay(d.createdAt) })),
        reviews: data.reviews,
      },
      week
    );
  }, [data, week]);

  const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "long", timeZone: "UTC" });
  const past = [...data.reviews].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));

  if (!week || !facts || !today) return <div className="h-40" aria-busy />;

  const save = () =>
    start(async () => {
      const res = await saveReview({
        weekStart: week,
        wins,
        blockers,
        lessons,
        focus,
        decisions: decisions.filter((d) => d.text.trim()).map((d) => ({ ...d, text: d.text.trim(), why: d.why.trim() })),
        zone: browserZone(),
      });
      if (res.ok) {
        toast(r.saved);
        setDecisions(res.data.decisions);
        router.refresh();
      } else toast(m.founder.errors[res.code], "error");
    });

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="space-y-3">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarRange className="h-4 w-4 text-accent" aria-hidden />
              {week === weekStartOf(today) ? r.thisWeek : fill(r.week, { date: dayLabel(week) })}
            </h2>
            <div className="flex gap-1">
              <button type="button" onClick={() => setWeek(addDays(week, -7))} className="rounded-md px-2 py-1 text-[0.8125rem] text-muted-foreground hover:bg-surface-2" aria-label="−1">
                ‹
              </button>
              <button
                type="button"
                disabled={week >= weekStartOf(today)}
                onClick={() => setWeek(addDays(week, 7))}
                className="rounded-md px-2 py-1 text-[0.8125rem] text-muted-foreground hover:bg-surface-2 disabled:opacity-30"
                aria-label="+1"
              >
                ›
              </button>
            </div>
          </div>
          <p className="mt-1 text-[0.72rem] text-muted">{r.factsNote}</p>
          <ul className="mt-3 space-y-1.5 text-[0.8125rem]">
            <li>{plural(locale, facts.notes.length, r.notes)}</li>
            <li>{plural(locale, facts.remindersDone.length, r.remindersDone)}</li>
            <li>
              {facts.transactions === 0
                ? r.noMoney
                : `${fill(r.moneyIn, { amount: money(facts.moneyIn, locale) })} · ${fill(r.moneyOut, { amount: money(facts.moneyOut, locale) })}`}
            </li>
            <li>{plural(locale, facts.newDeals.length, r.newDeals)}</li>
          </ul>
          {facts.notes.length > 0 && (
            <p className="mt-2 text-[0.72rem] leading-relaxed text-muted">{facts.notes.map((n) => n.title).join(" · ")}</p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <RotateCcw className="h-4 w-4 text-accent" aria-hidden />
            {r.revisit}
          </h2>
          {facts.revisit.length === 0 ? (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">{r.revisitNone}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {facts.revisit.map((d, i) => (
                <li key={i} className="rounded-lg border border-border p-2.5 text-[0.8125rem]">
                  <p className="font-medium">{d.text}</p>
                  {d.why && <p className="text-muted-foreground">{d.why}</p>}
                  <p className="mt-1 text-[0.72rem] text-muted">{fill(r.decidedOn, { date: dayLabel(d.decidedWeek) })}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-accent" aria-hidden />
              {r.past}
            </h2>
            <ul className="mt-2 space-y-1">
              {past.map((p) => (
                <li key={p.weekStart}>
                  <button
                    type="button"
                    onClick={() => setWeek(p.weekStart)}
                    className={cn("text-[0.8125rem] hover:text-foreground", p.weekStart === week ? "text-foreground" : "text-muted-foreground")}
                  >
                    {fill(r.week, { date: dayLabel(p.weekStart) })}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card className="p-5 lg:col-span-2">
        {!enabled && <p className="mb-3 text-[0.8125rem] text-warning">{m.founder.migration}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              [r.wins, r.winsHint, wins, setWins],
              [r.blockers, r.blockersHint, blockers, setBlockers],
            ] as const
          ).map(([label, hint, value, set]) => (
            <label key={label} className="block">
              <span className="mb-1.5 block text-[0.8125rem] font-medium">{label}</span>
              <textarea rows={5} maxLength={4000} placeholder={hint} value={value} onChange={(e) => set(e.target.value)} className={field} />
            </label>
          ))}
          <label className="block">
            <span className="mb-1.5 block text-[0.8125rem] font-medium">{r.lessons}</span>
            <textarea rows={4} maxLength={4000} value={lessons} onChange={(e) => setLessons(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[0.8125rem] font-medium">{r.focus}</span>
            <textarea rows={4} maxLength={1000} placeholder={r.focusHint} value={focus} onChange={(e) => setFocus(e.target.value)} className={field} />
          </label>
        </div>

        <div className="mt-5">
          <h3 className="text-[0.8125rem] font-medium">{r.decisions}</h3>
          <p className="text-[0.72rem] text-muted">{r.decisionsHint}</p>
          <ul className="mt-2 space-y-2">
            {decisions.map((d, i) => (
              <li key={d.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                <input
                  aria-label={r.decision}
                  placeholder={r.decision}
                  maxLength={300}
                  value={d.text}
                  onChange={(e) => setDecisions((all) => all.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  className={field}
                />
                <input
                  aria-label={r.why}
                  placeholder={r.why}
                  maxLength={600}
                  value={d.why}
                  onChange={(e) => setDecisions((all) => all.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)))}
                  className={field}
                />
                <label className="flex items-center gap-2 text-[0.72rem] text-muted-foreground">
                  {r.revisitOn}
                  <input
                    type="date"
                    value={d.revisitOn ?? ""}
                    min={week}
                    onChange={(e) => setDecisions((all) => all.map((x, j) => (j === i ? { ...x, revisitOn: e.target.value || null } : x)))}
                    className="h-9 rounded-lg border border-border bg-surface-2/60 px-2 text-[0.8125rem] outline-none focus:border-border-strong"
                  />
                </label>
                <button
                  type="button"
                  aria-label={r.removeDecision}
                  title={r.removeDecision}
                  onClick={() => setDecisions((all) => all.filter((_, j) => j !== i))}
                  className="justify-self-end rounded-md p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={decisions.length >= 20}
              onClick={() => setDecisions((all) => [...all, { id: newId(), text: "", why: "", revisitOn: null }])}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {r.addDecision}
            </button>
            {decisions.some((d) => d.revisitOn) && <span className="text-[0.72rem] text-muted">{r.reminderNote}</span>}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button type="button" disabled={pending || !enabled} onClick={save} className={buttonVariants({ size: "md" })}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {r.save}
          </button>
        </div>
      </Card>
    </div>
  );
}
