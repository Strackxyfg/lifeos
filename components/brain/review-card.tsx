"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, Check, Loader2, PenLine, Repeat } from "lucide-react";
import { categoryById } from "@/lib/data/brain";
import type { BrainNote } from "@/lib/brain/graph";
import { daysBetween, schedule, type ReviewAnswer, type ReviewQueue } from "@/lib/brain/review";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Today's review, one note at a time: read it, say whether it still holds.
 * Each button says what it will do ("back in 18 days"), because the rhythm is
 * the point — a note you keep confirming comes back less and less often.
 */
export function ReviewCard({
  queue,
  byId,
  today,
  answered,
  memory,
  onAnswer,
  onOpen,
}: {
  queue: ReviewQueue;
  byId: ReadonlyMap<string, BrainNote>;
  /** "YYYY-MM-DD". */
  today: string;
  /** Answered in this session: the progress counter starts from it. */
  answered: number;
  /** Migration 009: without it, only archiving is remembered. */
  memory: boolean;
  onAnswer: (id: string, answer: ReviewAnswer) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.brain.memory;
  const [busy, setBusy] = useState<ReviewAnswer | null>(null);

  const item = queue.items[0];
  const note = item ? byId.get(item.id) : undefined;
  if (!note) {
    if (answered === 0) return null;
    return (
      <section className="mt-6 rounded-xl border border-border bg-surface-2/30 p-4" aria-live="polite">
        <p className="flex items-center gap-2 text-[0.78rem] font-medium text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-success" /> {t.title}
        </p>
        <p className="mt-1 text-[0.74rem] leading-snug text-muted-foreground">{t.finished}</p>
      </section>
    );
  }

  const total = answered + queue.items.length;
  const cat = categoryById(note.category);
  const meta = item.first
    ? plural(locale, Math.max(0, daysBetween(note.createdAt.slice(0, 10), today)), t.firstTime)
    : plural(locale, Math.max(0, daysBetween((note.reviewedAt ?? note.createdAt).slice(0, 10), today)), t.lastTime);
  const keepIn = schedule(note, "keep", today, "").reviewInterval ?? 0;
  const later = queue.due - queue.items.length;

  const answer = async (a: ReviewAnswer) => {
    if (busy) return;
    setBusy(a);
    await onAnswer(note.id, a);
    setBusy(null);
  };

  const button = (a: ReviewAnswer, label: string, hint: string, Icon: typeof Check, tone: string) => (
    <button
      type="button"
      onClick={() => void answer(a)}
      disabled={!!busy || (!memory && a !== "archive")}
      title={!memory && a !== "archive" ? t.pending : hint}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors disabled:opacity-40",
        tone
      )}
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[0.76rem] font-medium">
        {busy === a ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />} {label}
      </span>
      <span className="truncate text-[0.66rem] text-muted-foreground">{hint}</span>
    </button>
  );

  return (
    <section aria-labelledby="daily-review-title" className="mt-6 rounded-xl border border-accent/25 bg-accent/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="daily-review-title" className="flex items-center gap-2 text-[0.78rem] font-medium">
          <Repeat className="h-3.5 w-3.5 text-accent" /> {t.title}
        </h2>
        <span className="font-mono text-[0.68rem] text-muted-foreground">
          {fill(t.progress, { i: answered + 1, n: total })}
        </span>
      </div>
      <p className="mt-1 text-[0.7rem] leading-snug text-muted-foreground">{t.hint}</p>

      <AnimatePresence mode="wait">
        <motion.div
          key={note.id}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18, ease }}
          className="mt-3 rounded-lg border border-border bg-surface p-3"
        >
          <p className="flex items-center gap-1.5 text-[0.66rem] text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
            {m.brain.cat[note.category].label} · {meta}
          </p>
          <button type="button" onClick={() => onOpen(note.id)} className="mt-1 text-left text-[0.86rem] leading-snug hover:underline">
            {note.title}
          </button>
          {note.detail && <p className="mt-1 line-clamp-3 text-[0.74rem] leading-snug text-muted-foreground">{note.detail}</p>}
        </motion.div>
      </AnimatePresence>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {button("keep", t.keep, plural(locale, keepIn, t.keepHint), Check, "hover:border-success/50 hover:text-success")}
        {button("rework", t.rework, t.reworkHint, PenLine, "hover:border-accent/50 hover:text-accent")}
        {button("archive", t.archive, t.archiveHint, Archive, "hover:border-border-strong")}
      </div>
      {!memory && <p className="mt-2 text-[0.66rem] text-muted">{t.pending}</p>}
      {later > 0 && <p className="mt-2 text-[0.66rem] text-muted">{plural(locale, later, t.more)}</p>}
    </section>
  );
}
