"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Brain, Check, Circle, History, Sparkles, Target } from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import type { BrainNote } from "@/lib/brain/graph";
import type { FocusEntry } from "@/lib/brain/focus";
import { ageInDays } from "@/lib/brain/focus";
import { focusReasonText } from "@/lib/brain/labels";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

const enter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.2, ease },
};

/** One note in a list. The dot says which region it lives in. */
export function NoteRow({
  note,
  onOpen,
  hint,
}: {
  note: BrainNote;
  onOpen: (id: string) => void;
  hint?: string;
}) {
  const m = useMessages();
  const cat = categoryById(note.category);
  const pending = note.id.startsWith("temp-");
  return (
    <button
      type="button"
      onClick={() => !pending && onOpen(note.id)}
      disabled={pending}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-left transition-colors",
        pending ? "opacity-60" : "hover:border-border-strong"
      )}
    >
      {note.category === "next" || note.category === "goals" ? (
        note.done ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        ) : (
          <Circle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: cat.color }} />
        )
      ) : (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[0.875rem] leading-snug", note.done && "text-muted-foreground line-through")}>
          {note.title}
          {note.ai && (
            <span
              title={m.brain.aiTagTitle}
              className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 align-middle text-[0.6rem] font-medium text-accent"
            >
              <Sparkles className="h-2.5 w-2.5" /> {m.brain.aiTag}
            </span>
          )}
        </span>
        {hint && <span className="mt-0.5 block text-[0.74rem] leading-snug text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

export function Overview({
  notes,
  focus,
  resurfaced,
  now,
  onOpen,
  onRegion,
}: {
  notes: BrainNote[];
  focus: FocusEntry[];
  resurfaced: BrainNote | null;
  now: Date;
  onOpen: (id: string) => void;
  onRegion: (id: BrainCategoryId) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const byId = new Map(notes.map((n) => [n.id, n]));
  const counts = new Map<BrainCategoryId, number>();
  for (const n of notes) if (!n.done) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);

  return (
    <motion.div {...enter}>
      {notes.length === 0 && (
        // A brand-new account, or one that skipped onboarding: say how to
        // start rather than showing six empty regions.
        <section className="mb-6 rounded-xl border border-accent/30 bg-accent/5 p-4">
          <p className="flex items-center gap-2 text-[0.875rem] font-medium">
            <Brain className="h-4 w-4 text-accent" /> {m.brain.emptyTitle}
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">{m.brain.emptyBody}</p>
          <Link
            href="/onboarding"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[0.8125rem] font-medium text-background"
          >
            {m.brain.emptyCta} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      )}

      <section aria-labelledby="focus-title">
        <h2 id="focus-title" className="flex items-center gap-2 text-[0.78rem] font-medium text-accent">
          <Target className="h-3.5 w-3.5" /> {m.brain.focusTitle}
        </h2>
        {focus.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {m.brain.focusEmpty}
          </p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1.5">
            {focus.map((f) => {
              const n = byId.get(f.id);
              return n ? (
                <li key={f.id}>
                  <NoteRow note={n} onOpen={onOpen} hint={focusReasonText(f.reason, m, locale)} />
                </li>
              ) : null;
            })}
          </ol>
        )}
      </section>

      {resurfaced && (
        <section aria-labelledby="resurface-title" className="mt-6">
          <h2 id="resurface-title" className="flex items-center gap-2 text-[0.78rem] font-medium text-muted-foreground">
            <History className="h-3.5 w-3.5" /> {m.brain.resurfaceTitle}
          </h2>
          <div className="mt-2">
            <NoteRow
              note={resurfaced}
              onOpen={onOpen}
              hint={plural(locale, ageInDays(resurfaced.createdAt, now), m.brain.resurfaceAge)}
            />
          </div>
        </section>
      )}

      <p className="mb-2 mt-6 text-[0.7rem] uppercase tracking-wider text-muted">{m.brain.regions}</p>
      <div className="grid grid-cols-2 gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onRegion(c.id)}
            className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong"
          >
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: `${c.color}18`, color: c.color }}>
              <c.icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[0.82rem] font-medium">{m.brain.cat[c.id].label}</span>
                <span className="font-mono text-[0.7rem] text-muted">{counts.get(c.id) ?? 0}</span>
              </span>
              <span className="block truncate text-[0.72rem] text-muted-foreground">{m.brain.cat[c.id].blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

export function RegionList({
  region,
  notes,
  onOpen,
  onBack,
}: {
  region: BrainCategoryId;
  notes: BrainNote[];
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const m = useMessages();
  const cat = categoryById(region);
  // Open first, newest first; finished work sinks to the bottom but stays findable.
  const list = notes
    .filter((n) => n.category === region)
    .sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt));

  return (
    <motion.div {...enter}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {m.brain.overview}
      </button>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${cat.color}18`, color: cat.color }}>
          <cat.icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[1.05rem] font-medium tracking-tight">{m.brain.cat[region].label}</h2>
          <p className="text-[0.75rem] text-muted-foreground">{m.brain.cat[region].blurb}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        {list.map((n) => (
          <NoteRow key={n.id} note={n} onOpen={onOpen} />
        ))}
        {list.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{m.brain.nothingHere}</p>
        )}
      </div>
    </motion.div>
  );
}

export function SearchResults({
  query,
  results,
  onOpen,
}: {
  query: string;
  results: BrainNote[];
  onOpen: (id: string) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  return (
    <motion.div {...enter}>
      <p className="mb-2 text-[0.72rem] text-muted-foreground" aria-live="polite">
        {results.length === 0 ? fill(m.brain.noResults, { q: query }) : plural(locale, results.length, m.brain.resultCount)}
      </p>
      <div className="flex flex-col gap-1.5">
        {results.map((n) => (
          <NoteRow key={n.id} note={n} onOpen={onOpen} hint={m.brain.cat[n.category].label} />
        ))}
      </div>
    </motion.div>
  );
}
