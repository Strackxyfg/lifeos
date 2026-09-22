"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Brain, Check, Circle, GitMerge, Hash, History, Loader2, Sparkles, Target, X, Zap,
} from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import type { BrainLink, BrainNote } from "@/lib/brain/graph";
import type { FocusEntry } from "@/lib/brain/focus";
import { ageInDays } from "@/lib/brain/focus";
import { focusReasonText } from "@/lib/brain/labels";
import { isUnreviewed, perspective } from "@/lib/brain/relations";
import type { Theme } from "@/lib/brain/concepts";
import { RelationChip, UnreviewedBadge } from "./relation-chip";
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

/** Where the "organise my brain" button stands, as the overview shows it. */
export type WeaveState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; created: number; analysed: number; stopped: null | "rate_limit" | "failed" | "migration_pending" };

export function Overview({
  notes,
  links,
  focus,
  resurfaced,
  themes,
  now,
  weave,
  weaveBlocked,
  onOpen,
  onRegion,
  onTheme,
  onReview,
  onWeave,
}: {
  notes: BrainNote[];
  links: BrainLink[];
  focus: FocusEntry[];
  resurfaced: BrainNote | null;
  themes: Theme[];
  now: Date;
  weave: WeaveState;
  /** Why automatic connections are off, if they are. */
  weaveBlocked: null | "noAi" | "pending";
  onOpen: (id: string) => void;
  onRegion: (id: BrainCategoryId) => void;
  onTheme: (key: string) => void;
  onReview: (linkId: string, decision: "keep" | "remove") => void;
  onWeave: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const byId = new Map(notes.map((n) => [n.id, n]));
  const counts = new Map<BrainCategoryId, number>();
  for (const n of notes) if (!n.done) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);

  // A connection read in its own direction: the source first when it has one.
  const ends = (l: BrainLink) => {
    const first = l.sourceId ?? l.fromId;
    const a = byId.get(first);
    const b = byId.get(first === l.fromId ? l.toId : l.fromId);
    return a && b ? { a, b } : null;
  };
  const toReview = links.filter((l) => isUnreviewed(l.origin) && !l.id.startsWith("temp-")).reverse();
  const tensions = links.filter((l) => l.kind === "tension");

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

      {toReview.length > 0 && (
        <section aria-labelledby="review-title" className="mt-6">
          <h2 id="review-title" className="flex items-center gap-2 text-[0.78rem] font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" /> {m.brain.review.title}
            <span className="font-mono text-muted">{toReview.length}</span>
          </h2>
          <p className="mt-1 text-[0.72rem] leading-snug text-muted-foreground">{m.brain.review.hint}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {toReview.slice(0, 4).map((l) => {
              const e = ends(l);
              if (!e) return null;
              return (
                <li key={l.id} className="rounded-lg border border-dashed border-accent/30 bg-surface p-2.5">
                  <ConnectionLine link={l} a={e.a} b={e.b} onOpen={onOpen} />
                  <div className="mt-2 flex items-center gap-1.5">
                    <UnreviewedBadge origin={l.origin} />
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => onReview(l.id, "keep")}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[0.72rem] hover:border-success/50 hover:text-success"
                    >
                      <Check className="h-3 w-3" /> {m.brain.review.keep}
                    </button>
                    <button
                      type="button"
                      onClick={() => onReview(l.id, "remove")}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[0.72rem] text-muted-foreground hover:border-danger/50 hover:text-danger"
                    >
                      <X className="h-3 w-3" /> {m.brain.review.remove}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {toReview.length > 4 && (
            <p className="mt-1.5 text-[0.7rem] text-muted-foreground">+{toReview.length - 4}</p>
          )}
        </section>
      )}

      {tensions.length > 0 && (
        <section aria-labelledby="tension-title" className="mt-6">
          <h2 id="tension-title" className="flex items-center gap-2 text-[0.78rem] font-medium" style={{ color: "#fb7185" }}>
            <Zap className="h-3.5 w-3.5" /> {m.brain.tensions.title}
          </h2>
          <p className="mt-1 text-[0.72rem] leading-snug text-muted-foreground">{m.brain.tensions.hint}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {tensions.slice(0, 3).map((l) => {
              const e = ends(l);
              return e ? (
                <li key={l.id} className="rounded-lg border border-border bg-surface p-2.5">
                  <ConnectionLine link={l} a={e.a} b={e.b} onOpen={onOpen} />
                </li>
              ) : null;
            })}
          </ul>
        </section>
      )}

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

      {themes.length > 0 && (
        <section aria-labelledby="themes-title" className="mt-6">
          <h2 id="themes-title" className="flex items-center gap-2 text-[0.78rem] font-medium text-muted-foreground">
            <Hash className="h-3.5 w-3.5" /> {m.brain.themes.title}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {themes.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onTheme(t.key)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[0.75rem] transition-colors hover:border-border-strong"
              >
                {t.label}
                <span className="font-mono text-[0.66rem] text-muted">{t.noteIds.length}</span>
              </button>
            ))}
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

      {notes.length > 1 && <WeaveCard state={weave} blocked={weaveBlocked} onRun={onWeave} />}
    </motion.div>
  );
}

/** "A — moves forward — B", with the reason underneath. Titles open their note. */
function ConnectionLine({
  link,
  a,
  b,
  onOpen,
}: {
  link: BrainLink;
  a: BrainNote;
  b: BrainNote;
  onOpen: (id: string) => void;
}) {
  const title = (n: BrainNote) => (
    <button
      type="button"
      onClick={() => onOpen(n.id)}
      className="inline text-left text-[0.8rem] leading-snug underline-offset-2 hover:underline"
    >
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: categoryById(n.category).color }} />
      {n.title}
    </button>
  );
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {title(a)}
        <RelationChip kind={link.kind} side={perspective(link.kind, a.id, link.sourceId)} />
        {title(b)}
      </div>
      {link.reason && <p className="mt-1 text-[0.72rem] leading-snug text-muted-foreground">{link.reason}</p>}
    </div>
  );
}

/** The "organise my brain" button, and what its last run did. */
function WeaveCard({
  state,
  blocked,
  onRun,
}: {
  state: WeaveState;
  blocked: null | "noAi" | "pending";
  onRun: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.brain.weave;

  let status: string | null = null;
  if (blocked) status = blocked === "noAi" ? t.noAi : t.pending;
  else if (state.phase === "done") {
    if (state.stopped === "rate_limit") status = t.rateLimited;
    else if (state.stopped === "failed") status = t.failed;
    else if (state.stopped === "migration_pending") status = t.pending;
    else if (state.created > 0) {
      status = `${plural(locale, state.created, t.created)}${state.analysed ? ` · ${plural(locale, state.analysed, t.analysed)}` : ""}`;
    } else status = t.nothing;
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface-2/30 p-4">
      <p className="flex items-center gap-2 text-[0.82rem] font-medium">
        <GitMerge className="h-4 w-4 text-accent" /> {t.title}
      </p>
      <p className="mt-1 text-[0.74rem] leading-relaxed text-muted-foreground">{t.body}</p>
      <button
        type="button"
        onClick={onRun}
        disabled={!!blocked || state.phase === "running"}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.78rem] font-medium text-background transition-opacity disabled:opacity-40"
      >
        {state.phase === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {state.phase === "running" ? t.running : t.button}
      </button>
      {status && (
        <p role="status" className="mt-2 text-[0.72rem] leading-snug text-muted-foreground">
          {status}
        </p>
      )}
    </section>
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

export function ThemeList({
  theme,
  notes,
  onOpen,
  onBack,
}: {
  theme: Theme;
  notes: BrainNote[];
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const ids = new Set(theme.noteIds);
  const list = notes
    .filter((n) => ids.has(n.id))
    .sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt));

  return (
    <motion.div {...enter}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {m.brain.overview}
      </button>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
          <Hash className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[1.05rem] font-medium tracking-tight">{theme.label}</h2>
          <p className="text-[0.75rem] text-muted-foreground">{plural(locale, list.length, m.brain.themes.count)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        {list.map((n) => (
          <NoteRow key={n.id} note={n} onOpen={onOpen} hint={m.brain.cat[n.category].label} />
        ))}
      </div>
    </motion.div>
  );
}
