"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Check, GitMerge, Hash, Link2, Loader2, Plus, RotateCcw, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import { neighborsOf, suggestLinks, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { RELATION_KINDS, isUnreviewed, perspective, type RelationKind } from "@/lib/brain/relations";
import { searchNotes } from "@/lib/brain/search";
import { proposeNextSteps } from "@/app/actions/weave";
import { toast } from "@/components/ui/toaster";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { RelationChip, UnreviewedBadge } from "./relation-chip";

export interface NotePatch {
  title?: string;
  detail?: string | null;
  category?: BrainCategoryId;
  done?: boolean;
}

const isTemp = (id: string) => id.startsWith("temp-");

/** Unreviewed first, then the most meaningful kinds, then newest. */
const KIND_ORDER: Record<RelationKind, number> = { advances: 0, supports: 1, tension: 2, extends: 3, related: 4 };

export function NoteDetail({
  note,
  notes,
  links,
  dismissed,
  linksAvailable,
  synapses,
  aiEnabled,
  onBack,
  onOpen,
  onTheme,
  onUpdate,
  onDelete,
  onLink,
  onUnlink,
  onReview,
  onRetype,
  onDismiss,
  onFindLinks,
  onAdoptSteps,
}: {
  note: BrainNote;
  notes: BrainNote[];
  links: BrainLink[];
  dismissed: ReadonlySet<string>;
  linksAvailable: boolean;
  /** Migration 008: typed connections, reviews, dismissals. */
  synapses: boolean;
  aiEnabled: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onTheme: (key: string) => void;
  onUpdate: (id: string, patch: NotePatch) => void;
  onDelete: (id: string) => void;
  onLink: (a: string, b: string, origin: "user" | "suggested", reason?: string) => void;
  onUnlink: (linkId: string) => void;
  onReview: (linkId: string, decision: "keep" | "remove") => void;
  onRetype: (linkId: string, kind: RelationKind) => void;
  onDismiss: (a: string, b: string) => void;
  onFindLinks: (id: string) => Promise<void>;
  onAdoptSteps: (id: string, steps: string[]) => Promise<boolean>;
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
  const [finding, setFinding] = useState(false);
  const [steps, setSteps] = useState<{ phase: "idle" | "thinking" | "shown" | "adding"; list: string[]; keep: Set<number> }>({
    phase: "idle",
    list: [],
    keep: new Set(),
  });
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
    setFinding(false);
    setSteps({ phase: "idle", list: [], keep: new Set() });
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
        .filter((x): x is { link: BrainLink; other: BrainNote } => !!x.other)
        .sort(
          (x, y) =>
            Number(isUnreviewed(y.link.origin)) - Number(isUnreviewed(x.link.origin)) ||
            KIND_ORDER[x.link.kind] - KIND_ORDER[y.link.kind] ||
            x.other.title.localeCompare(y.other.title)
        ),
    [links, note.id, byId]
  );
  const suggestions = useMemo(
    () =>
      linksAvailable && !isTemp(note.id)
        ? suggestLinks(note, notes.filter((n) => !isTemp(n.id)), links, 3, dismissed)
        : [],
    [linksAvailable, note, notes, links, dismissed]
  );
  const candidates = useMemo(() => {
    if (!pick.trim()) return [];
    const exclude = neighborsOf(note.id, links);
    exclude.add(note.id);
    return searchNotes(notes.filter((n) => !exclude.has(n.id) && !isTemp(n.id)), pick, 6);
  }, [pick, notes, links, note.id]);

  const canComplete = note.category === "next" || note.category === "goals";
  const developLabel =
    note.category === "goals" ? m.brain.develop.goals : note.category === "ideas" ? m.brain.develop.ideas : m.brain.develop.other;
  // A next step is already an action; a finished note needs none.
  const canDevelop = aiEnabled && !note.done && note.category !== "next" && !isTemp(note.id);
  const created = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { dateStyle: "long" }).format(
    new Date(note.createdAt)
  );

  const propose = async () => {
    setSteps({ phase: "thinking", list: [], keep: new Set() });
    const res = await proposeNextSteps(note.id).catch(() => null);
    if (!res || !res.ok) {
      toast(m.brain.errors[res && !res.ok ? res.code : "failed"], "error");
      setSteps({ phase: "idle", list: [], keep: new Set() });
      return;
    }
    if (res.data.length === 0) toast(m.brain.develop.empty);
    setSteps({
      phase: res.data.length ? "shown" : "idle",
      list: res.data,
      keep: new Set(res.data.map((_, i) => i)),
    });
  };

  const adopt = async () => {
    const chosen = steps.list.filter((_, i) => steps.keep.has(i));
    if (chosen.length === 0) return;
    setSteps((s) => ({ ...s, phase: "adding" }));
    const ok = await onAdoptSteps(note.id, chosen);
    setSteps(ok ? { phase: "idle", list: [], keep: new Set() } : (s) => ({ ...s, phase: "shown" }));
  };

  const find = async () => {
    setFinding(true);
    await onFindLinks(note.id);
    setFinding(false);
  };

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

      {note.concepts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[0.68rem] uppercase tracking-wider text-muted">{m.brain.note.about}</span>
          {note.concepts.map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => onTheme(c.k)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-px text-[0.7rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Hash className="h-2.5 w-2.5" /> {c.l}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
        {canDevelop && steps.phase === "idle" && (
          <button
            type="button"
            onClick={propose}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 text-[0.75rem] text-accent hover:bg-accent/10"
          >
            <Wand2 className="h-3.5 w-3.5" /> {developLabel}
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

      {/* ── From this note to action ───────────────────────────────── */}
      {steps.phase !== "idle" && (
        <section className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3" aria-live="polite">
          {steps.phase === "thinking" ? (
            <p className="flex items-center gap-2 text-[0.78rem] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> {m.brain.develop.running}
            </p>
          ) : (
            <>
              <p className="text-[0.72rem] font-medium uppercase tracking-wider text-accent">{m.brain.develop.title}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {steps.list.map((s, i) => (
                  <li key={s}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-[0.8rem] hover:bg-surface-2/60">
                      <input
                        type="checkbox"
                        checked={steps.keep.has(i)}
                        onChange={() =>
                          setSteps((prev) => {
                            const keep = new Set(prev.keep);
                            if (keep.has(i)) keep.delete(i);
                            else keep.add(i);
                            return { ...prev, keep };
                          })
                        }
                        className="mt-0.5 accent-[#22d3ee]"
                      />
                      <span className="leading-snug">{s}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={adopt}
                  disabled={steps.keep.size === 0 || steps.phase === "adding"}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[0.75rem] font-medium text-background disabled:opacity-40"
                >
                  {steps.phase === "adding" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {plural(locale, steps.keep.size, m.brain.develop.add)}
                </button>
                <button
                  type="button"
                  onClick={() => setSteps({ phase: "idle", list: [], keep: new Set() })}
                  className="text-[0.75rem] text-muted-foreground hover:text-foreground"
                >
                  {m.brain.develop.cancel}
                </button>
              </div>
            </>
          )}
        </section>
      )}

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
              <ul className="mt-2 flex flex-col gap-1.5">
                {linked.map(({ link, other }) => {
                  const pending = isUnreviewed(link.origin);
                  return (
                    <li
                      key={link.id}
                      className={cn(
                        "rounded-md border bg-surface px-2.5 py-2",
                        pending ? "border-dashed border-accent/40" : "border-border"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <RelationChip kind={link.kind} side={perspective(link.kind, note.id, link.sourceId)} />
                            <button
                              type="button"
                              onClick={() => onOpen(other.id)}
                              className="min-w-0 text-left text-[0.8rem] leading-snug hover:underline"
                            >
                              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: categoryById(other.category).color }} />
                              {other.title}
                            </button>
                          </div>
                          {link.reason && <p className="mt-1 text-[0.72rem] leading-snug text-muted-foreground">{link.reason}</p>}
                        </div>
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
                      </div>
                      {(pending || synapses) && !isTemp(link.id) && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {pending && <UnreviewedBadge origin={link.origin} />}
                          {synapses && (
                            <>
                              <label className="sr-only" htmlFor={`kind-${link.id}`}>{m.brain.links.kind}</label>
                              <select
                                id={`kind-${link.id}`}
                                value={link.kind}
                                onChange={(e) => onRetype(link.id, e.target.value as RelationKind)}
                                className="rounded border border-border bg-surface-2/40 px-1 py-px text-[0.66rem] text-muted-foreground outline-none focus:border-border-strong"
                              >
                                {RELATION_KINDS.map((k) => (
                                  <option key={k} value={k}>{m.brain.relationName[k]}</option>
                                ))}
                              </select>
                            </>
                          )}
                          <span className="flex-1" />
                          {pending && (
                            <button
                              type="button"
                              onClick={() => onReview(link.id, "keep")}
                              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px text-[0.68rem] hover:border-success/50 hover:text-success"
                            >
                              <Check className="h-3 w-3" /> {m.brain.review.keep}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
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
                        {synapses && (
                          <button
                            type="button"
                            onClick={() => onDismiss(note.id, s.id)}
                            aria-label={m.brain.links.dismiss}
                            title={m.brain.links.dismiss}
                            className="grid h-6 w-5 shrink-0 place-items-center rounded text-muted hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              {!picking && (
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  disabled={isTemp(note.id)}
                  className="inline-flex items-center gap-1.5 text-[0.78rem] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> {m.brain.links.add}
                </button>
              )}
              {!picking && aiEnabled && synapses && !isTemp(note.id) && (
                <button
                  type="button"
                  onClick={find}
                  disabled={finding}
                  className="inline-flex items-center gap-1.5 text-[0.78rem] text-accent hover:underline disabled:opacity-60"
                >
                  {finding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                  {finding ? m.brain.links.finding : m.brain.links.find}
                </button>
              )}
              {picking && (
                <div className="w-full">
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
