"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Pencil, Quote, Trash2, X } from "lucide-react";
import type { Evidence, TraitLike } from "@/lib/self/portrait";
import { plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export interface TraitHandlers {
  onJudge: (id: string, verdict: "confirmed" | "rejected") => void;
  onCorrect: (id: string, statement: string) => Promise<boolean>;
  onRemove: (id: string) => void;
}

/**
 * One trait of the portrait: what the double says, whose words it rests on
 * (shown on demand, each quote linking to its note), and the person's word
 * on it — "that's me", "not me", or their own correction.
 */
export function TraitRow({
  trait,
  quotes,
  handlers,
  compact = false,
}: {
  trait: TraitLike;
  /** Quotes still true, with the title of their note. */
  quotes: (Evidence & { title: string })[];
  handlers: TraitHandlers;
  compact?: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.portrait;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trait.statement);
  const [saving, setSaving] = useState(false);
  const proposed = trait.status === "proposed";

  const save = async () => {
    const text = draft.trim();
    if (text.length < 3 || text === trait.statement) return setEditing(false);
    setSaving(true);
    const ok = await handlers.onCorrect(trait.id, text);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <li className={cn("rounded-lg border bg-surface p-3", proposed ? "border-dashed border-accent/40" : "border-border")}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            rows={2}
            autoFocus
            aria-label={t.edit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") setEditing(false);
            }}
            className="w-full resize-none rounded-md border border-border bg-surface-2/40 px-2.5 py-1.5 text-[0.84rem] outline-none focus:border-border-strong"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-[0.74rem] text-muted-foreground hover:text-foreground">
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-foreground px-2.5 py-1 text-[0.74rem] font-medium text-background disabled:opacity-50"
            >
              {t.save}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[0.86rem] leading-snug">{trait.statement}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[0.62rem] font-medium",
                proposed ? "bg-accent/10 text-accent" : trait.origin === "person" ? "bg-surface-2 text-muted-foreground" : "bg-success/10 text-success"
              )}
            >
              {proposed ? t.proposed : trait.origin === "person" ? t.yours : t.confirmed}
            </span>
            {quotes.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground hover:text-foreground"
              >
                <Quote className="h-3 w-3" />
                {plural(locale, new Set(quotes.map((q) => q.noteId)).size, t.quotes)}
                <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
              </button>
            )}
            <span className="flex-1" />
            {proposed ? (
              <>
                <button
                  type="button"
                  onClick={() => handlers.onJudge(trait.id, "confirmed")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[0.72rem] hover:border-success/50 hover:text-success"
                >
                  <Check className="h-3 w-3" /> {t.confirm}
                </button>
                <button
                  type="button"
                  onClick={() => handlers.onJudge(trait.id, "rejected")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[0.72rem] text-muted-foreground hover:border-danger/50 hover:text-danger"
                >
                  <X className="h-3 w-3" /> {t.reject}
                </button>
              </>
            ) : null}
            {!compact && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(trait.statement);
                    setEditing(true);
                  }}
                  aria-label={t.edit}
                  title={t.edit}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {!proposed && (
                  <button
                    type="button"
                    onClick={() => handlers.onRemove(trait.id)}
                    aria-label={t.remove}
                    title={t.remove}
                    className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </>
            )}
          </div>
          {open && (
            <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-border pl-2.5">
              {quotes.map((q) => (
                <li key={`${q.noteId}|${q.quote}`} className="text-[0.76rem] leading-snug">
                  <span className="italic text-foreground/85">{locale === "fr" ? `« ${q.quote} »` : `“${q.quote}”`}</span>{" "}
                  <Link href={`/brain?note=${encodeURIComponent(q.noteId)}`} className="text-muted-foreground underline-offset-2 hover:underline">
                    — {q.title.length > 80 ? `${q.title.slice(0, 79).trimEnd()}…` : q.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}
