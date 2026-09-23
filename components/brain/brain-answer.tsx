"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, RotateCcw, Search, Sparkles } from "lucide-react";
import { categoryById } from "@/lib/data/brain";
import { parseTrace, type ThoughtTrace } from "@/lib/brain/context";
import { RELATION_COLOR } from "@/lib/brain/relations";
import { normalize } from "@/lib/brain/text";
import type { BrainNote } from "@/lib/brain/graph";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { ease } from "@/lib/motion";

/**
 * A question asked of the brain, from the brain page: the answer streams in
 * while the 3D brain shows how it was read (`thought-trace.tsx`), and the
 * notes the model was given are listed with why each was — the words or the
 * subject it matched on, or the connection that led to it.
 *
 * When the answer names a note in quotes, the name opens the note.
 */
export function BrainAnswer({
  question,
  notes,
  onTrace,
  onOpen,
  onBack,
  onReplay,
  onAgain,
}: {
  question: string;
  notes: BrainNote[];
  /** The trace, as soon as the server has read the brain — before the answer is written. */
  onTrace: (trace: ThoughtTrace | null) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
  onReplay: () => void;
  onAgain: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.brain.ask;
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"reading" | "answering" | "done" | "failed">("reading");
  const [trace, setTrace] = useState<ThoughtTrace | null>(null);
  // The latest callback, without restarting the request when it changes.
  const traced = useRef(onTrace);
  traced.current = onTrace;

  useEffect(() => {
    const abort = new AbortController();
    setText("");
    setTrace(null);
    setPhase("reading");
    (async () => {
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: question }], locale }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
        let parsed: ThoughtTrace | null = null;
        try {
          const raw = res.headers.get("X-Brain-Trace");
          parsed = raw ? parseTrace(JSON.parse(decodeURIComponent(raw))) : null;
        } catch {
          parsed = null;
        }
        setTrace(parsed);
        traced.current(parsed);
        setPhase("answering");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
        setPhase("done");
      } catch {
        // Leaving the view aborts the request: that is not a failure to show.
        if (!abort.signal.aborted) setPhase("failed");
      }
    })();
    return () => abort.abort();
  }, [question, locale]);

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const seeds = (trace?.seeds ?? []).filter((s) => byId.has(s.id));
  const seedIds = new Set(seeds.map((s) => s.id));
  const hops = (trace?.hops ?? []).filter(
    (h, i, all) => byId.has(h.to) && byId.has(h.from) && !seedIds.has(h.to) && all.findIndex((x) => x.to === h.to) === i
  );
  const always = (trace?.context ?? []).filter((id) => byId.has(id) && !seedIds.has(id) && !hops.some((h) => h.to === id));

  // Titles the answer may quote, the notes it was given first.
  const quotable = useMemo(() => {
    const ids = [...seeds.map((s) => s.id), ...hops.map((h) => h.to), ...always];
    const first = ids.map((id) => byId.get(id)).filter((n): n is BrainNote => !!n);
    return [...first, ...notes.filter((n) => !ids.includes(n.id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, notes]);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease }}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {m.brain.overview}
      </button>

      <p className="flex items-start gap-2 text-[0.95rem] font-medium leading-snug tracking-tight">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {question}
      </p>

      <div className="mt-3 min-h-[3rem] text-[0.82rem] leading-relaxed" aria-live="polite" aria-busy={phase !== "done" && phase !== "failed"}>
        {phase === "reading" ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.thinking}
          </p>
        ) : phase === "failed" && !text ? (
          <p className="text-muted-foreground">{t.failed}</p>
        ) : (
          <Answer text={text} notes={quotable} onOpen={onOpen} />
        )}
      </div>

      {trace && (
        <section className="mt-5 border-t border-border pt-4">
          <p className="text-[0.72rem] font-medium uppercase tracking-wide text-muted">
            {plural(locale, seeds.length + hops.length + always.length, t.read)}
          </p>

          {seeds.length === 0 && <p className="mt-2 text-[0.74rem] leading-snug text-muted-foreground">{t.none}</p>}

          {seeds.length > 0 && (
            <>
              <p className="mt-3 text-[0.7rem] text-muted">{t.found}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {seeds.map((s) => (
                  <Row
                    key={s.id}
                    note={byId.get(s.id)!}
                    hint={fill(s.via === "concepts" ? t.bySubject : t.byWords, { words: s.shared.join(", ") })}
                    mark="#67e8f9"
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            </>
          )}

          {hops.length > 0 && (
            <>
              <p className="mt-3 text-[0.7rem] text-muted">{t.followed}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {hops.map((h) => (
                  <Row
                    key={h.to}
                    note={byId.get(h.to)!}
                    hint={`${m.brain.relationName[h.kind]} · ${fill(t.from, { title: byId.get(h.from)!.title })}`}
                    mark={RELATION_COLOR[h.kind]}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            </>
          )}

          {always.length > 0 && <p className="mt-3 text-[0.7rem] text-muted">{plural(locale, always.length, t.always)}</p>}
        </section>
      )}

      {(phase === "done" || phase === "failed") && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {trace && (
            <button type="button" onClick={onReplay} className="inline-flex items-center gap-1.5 text-[0.76rem] text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" /> {t.replay}
            </button>
          )}
          <button type="button" onClick={onAgain} className="inline-flex items-center gap-1.5 text-[0.76rem] text-muted-foreground hover:text-foreground">
            <Search className="h-3.5 w-3.5" /> {t.again}
          </button>
        </div>
      )}
    </motion.div>
  );
}

function Row({ note, hint, mark, onOpen }: { note: BrainNote; hint: string; mark: string; onOpen: (id: string) => void }) {
  const cat = categoryById(note.category);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        className="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-2/60"
      >
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: mark, boxShadow: `0 0 6px ${mark}` }} />
        <span className="min-w-0">
          <span className="block truncate text-[0.78rem] group-hover:text-foreground">{note.title}</span>
          <span className="block truncate text-[0.68rem] text-muted-foreground">
            <span style={{ color: cat.color }}>●</span> {hint}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ── The answer's text ─────────────────────────────────────────────── */

const QUOTE = /(«\s?|“|")([^«»“”"\n]{3,200}?)(\s?»|”|")/g;
const flat = (s: string) =>
  normalize(s)
    .replace(/[.!?…:;,]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

/** The note a quoted title refers to: same words, or one the quote begins or cuts short. */
function noteFor(quote: string, notes: BrainNote[]): BrainNote | null {
  const q = flat(quote);
  if (q.length < 3) return null;
  return (
    notes.find((n) => flat(n.title) === q) ??
    notes.find((n) => {
      const title = flat(n.title);
      return (q.length >= 15 && title.startsWith(q)) || (title.length >= 15 && q.startsWith(title));
    }) ??
    null
  );
}

function inline(line: string, notes: BrainNote[], onOpen: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(QUOTE)) {
    const [whole, open, inner, close] = match;
    const note = noteFor(inner, notes);
    if (!note) continue;
    const at = match.index ?? 0;
    out.push(...bold(line.slice(last, at), out.length));
    out.push(
      <button
        key={`q${at}`}
        type="button"
        onClick={() => onOpen(note.id)}
        className="rounded-sm text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {open}
        {inner}
        {close}
      </button>
    );
    last = at + whole.length;
  }
  out.push(...bold(line.slice(last), out.length));
  return out;
}

function bold(text: string, key: number): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 === 1 ? <strong key={`b${key}-${i}`}>{part}</strong> : part));
}

function Answer({ text, notes, onOpen }: { text: string; notes: BrainNote[]; onOpen: (id: string) => void }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const bullets = lines.length > 0 && lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l));
        if (bullets) {
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-4 marker:text-muted">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ""), notes, onOpen)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, notes, onOpen)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
