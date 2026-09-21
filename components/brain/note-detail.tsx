"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Link2, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import { neighborsOf, suggestLinks, type BrainNote } from "@/lib/brain/graph";
import { searchNotes } from "@/lib/brain/search";
import { fill } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

export interface ClientLink {
  id: string;
  fromId: string;
  toId: string;
  reason: string | null;
  origin: "user" | "suggested";
}

export interface NotePatch {
  title?: string;
  detail?: string | null;
  category?: BrainCategoryId;
  done?: boolean;
}

const isTemp = (id: string) => id.startsWith("temp-");

export function NoteDetail({
  note,
  notes,
  links,
  linksAvailable,
  onBack,
  onOpen,
  onUpdate,
  onDelete,
  onLink,
  onUnlink,
}: {
  note: BrainNote;
  notes: BrainNote[];
  links: ClientLink[];
  linksAvailable: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: NotePatch) => void;
  onDelete: (id: string) => void;
  onLink: (a: string, b: string, origin: "user" | "suggested", reason?: string) => void;
  onUnlink: (linkId: string) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const cat = categoryById(note.category);

  // Local drafts, re-synced when a different note is opened.
  const [title, setTitle] = useState(note.title);
  const [detail, setDetail] = useState(note.detail ?? "");
  const [confirming, setConfirming] = useState(false);
  const [pick, setPick] = useState("");
  const [picking, setPicking] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Grow the title field to fit. CSS `field-sizing: content` would do this,
  // but only Chromium supports it; elsewhere a long title would be cut to one
  // scrolling line.
  const fitTitle = () => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    setTitle(note.title);
    setDetail(note.detail ?? "");
    setConfirming(false);
    setPick("");
    setPicking(false);
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(fitTitle, [title]);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const saveTitle = () => {
    const t = title.trim();
    // An empty title would be rejected; restore rather than save nothing.
    if (!t) return setTitle(note.title);
    if (t !== note.title) onUpdate(note.id, { title: t });
  };
  const saveDetail = () => {
    const d = detail.trim();
    if (d !== (note.detail ?? "").trim()) onUpdate(note.id, { detail: d || null });
  };

  // Deletion takes two deliberate clicks within four seconds — a stray click
  // or a double-click can't destroy a note and its connections.
  const askDelete = () => {
    if (confirming) {
      clearTimeout(confirmTimer.current);
      onDelete(note.id);
      return;
    }
    setConfirming(true);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4_000);
  };

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const linked = useMemo(
    () =>
      links
        .filter((l) => l.fromId === note.id || l.toId === note.id)
        .map((l) => ({ link: l, other: byId.get(l.fromId === note.id ? l.toId : l.fromId) }))
        .filter((x): x is { link: ClientLink; other: BrainNote } => !!x.other),
    [links, note.id, byId]
  );
  const suggestions = useMemo(
    () =>
      linksAvailable && !isTemp(note.id)
        ? suggestLinks(note, notes.filter((n) => !isTemp(n.id)), links, 3)
        : [],
    [linksAvailable, note, notes, links]
  );
  const candidates = useMemo(() => {
    if (!pick.trim()) return [];
    const exclude = neighborsOf(note.id, links);
    exclude.add(note.id);
    return searchNotes(notes.filter((n) => !exclude.has(n.id) && !isTemp(n.id)), pick, 6);
  }, [pick, notes, links, note.id]);

  const canComplete = note.category === "next" || note.category === "goals";
  const created = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { dateStyle: "long" }).format(
    new Date(note.createdAt)
  );

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease }}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {m.brain.back}
      </button>

      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
        <label className="sr-only" htmlFor="note-region">{m.brain.note.region}</label>
        <select
          id="note-region"
          value={note.category}
          onChange={(e) => onUpdate(note.id, { category: e.target.value as BrainCategoryId })}
          className="rounded-md border border-border bg-surface-2/40 px-2 py-1 text-[0.75rem] text-muted-foreground outline-none focus:border-border-strong"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{m.brain.cat[c.id].label}</option>
          ))}
        </select>
        {note.ai && (
          <span title={m.brain.aiTagTitle} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-accent">
            <Sparkles className="h-2.5 w-2.5" /> {m.brain.aiTag}
          </span>
        )}
      </div>

      <label className="sr-only" htmlFor="note-title">{m.brain.note.titlePlaceholder}</label>
      <textarea
        id="note-title"
        ref={titleRef}
        value={title}
        rows={1}
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        placeholder={m.brain.note.titlePlaceholder}
        className={cn(
          "mt-3 w-full resize-none overflow-hidden bg-transparent text-[1.05rem] font-medium leading-snug tracking-tight outline-none",
          note.done && "text-muted-foreground line-through"
        )}
      />

      <label className="sr-only" htmlFor="note-detail">{m.brain.note.detailPlaceholder}</label>
      <textarea
        id="note-detail"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        onBlur={saveDetail}
        maxLength={20_000}
        placeholder={m.brain.note.detailPlaceholder}
        className="mt-2 min-h-[88px] w-full resize-y rounded-lg border border-border bg-surface-2/30 p-2.5 text-[0.84rem] leading-relaxed outline-none placeholder:text-muted focus:border-border-strong"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canComplete && (
          <button
            type="button"
            onClick={() => onUpdate(note.id, { done: !note.done })}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[0.75rem] hover:border-border-strong"
          >
            {note.done ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-success" />}
            {note.done ? m.brain.note.reopen : note.category === "goals" ? m.brain.note.reached : m.brain.note.markDone}
          </button>
        )}
        <button
          type="button"
          onClick={askDelete}
          aria-live="polite"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.75rem] transition-colors",
            confirming ? "border-danger/50 bg-danger/10 text-danger" : "border-border text-muted-foreground hover:text-danger"
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {confirming ? m.brain.note.deleteConfirm : m.brain.note.delete}
        </button>
        <span className="ml-auto text-[0.7rem] text-muted">{fill(m.brain.note.created, { date: created })}</span>
      </div>

      {/* ── Connections ────────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby="links-title">
        <h3 id="links-title" className="flex items-center gap-2 text-[0.78rem] font-medium text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" /> {m.brain.links.title}
          {linked.length > 0 && <span className="font-mono text-muted">{linked.length}</span>}
        </h3>

        {!linksAvailable ? (
          <p className="mt-2 rounded-lg border border-dashed border-border p-3 text-[0.78rem] leading-relaxed text-muted-foreground">
            {m.brain.links.unavailable}
          </p>
        ) : (
          <>
            {linked.length === 0 ? (
              <p className="mt-2 text-[0.78rem] text-muted-foreground">{m.brain.links.empty}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {linked.map(({ link, other }) => (
                  <li key={link.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: categoryById(other.category).color }} />
                    <button type="button" onClick={() => onOpen(other.id)} className="min-w-0 flex-1 truncate text-left text-[0.8rem] hover:underline">
                      {other.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUnlink(link.id)}
                      disabled={isTemp(link.id)}
                      aria-label={m.brain.links.remove}
                      title={m.brain.links.remove}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:text-danger disabled:opacity-40"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {suggestions.length > 0 && (
              <div className="mt-4">
                <p className="text-[0.7rem] uppercase tracking-wider text-muted">{m.brain.links.suggested}</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {suggestions.map((s) => {
                    const other = byId.get(s.id);
                    if (!other) return null;
                    return (
                      <li key={s.id} className="flex items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: categoryById(other.category).color }} />
                        <span className="min-w-0 flex-1">
                          <button type="button" onClick={() => onOpen(other.id)} className="block w-full truncate text-left text-[0.8rem] hover:underline">
                            {other.title}
                          </button>
                          <span className="block truncate text-[0.7rem] text-muted-foreground">
                            {fill(m.brain.links.because, { words: s.shared.slice(0, 3).join(", ") })}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onLink(note.id, s.id, "suggested", s.shared.slice(0, 3).join(", "))}
                          className="shrink-0 rounded-md border border-accent/40 px-2 py-0.5 text-[0.72rem] text-accent hover:bg-accent/10"
                        >
                          {m.brain.links.connect}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="mt-4">
              {!picking ? (
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  disabled={isTemp(note.id)}
                  className="inline-flex items-center gap-1.5 text-[0.78rem] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> {m.brain.links.add}
                </button>
              ) : (
                <div>
                  <input
                    autoFocus
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setPicking(false);
                        setPick("");
                      }
                    }}
                    placeholder={m.brain.links.searchPlaceholder}
                    aria-label={m.brain.links.searchPlaceholder}
                    className="h-8 w-full rounded-md border border-border bg-surface-2/40 px-2.5 text-[0.8rem] outline-none focus:border-border-strong"
                  />
                  {candidates.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {candidates.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onLink(note.id, c.id, "user");
                              setPick("");
                              setPicking(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8rem] hover:bg-surface-2"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: categoryById(c.category).color }} />
                            <span className="truncate">{c.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </motion.div>
  );
}
