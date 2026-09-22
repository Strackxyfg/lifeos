"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { ArrowUp, Brain, Mic, Search, Sparkles, Square, X } from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import { canonicalPair, pairKey, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { computeFocus } from "@/lib/brain/focus";
import { pickResurface } from "@/lib/brain/resurface";
import { searchNotes } from "@/lib/brain/search";
import { themes as findThemes } from "@/lib/brain/concepts";
import { MAX_RENDERED_NODES, nodePosition } from "@/lib/brain/layout";
import { RELATION_COLOR, isUnreviewed, perspective, type RelationKind } from "@/lib/brain/relations";
import { relationText } from "@/lib/brain/labels";
import {
  createNote, deleteNote, dismissPair, linkNotes, retypeLink, reviewLink, unlinkNotes, updateNote,
  type BrainErrorCode, type BrainResult,
} from "@/app/actions/brain";
import { adoptNextSteps, weaveBrain, weaveNotes, type WeaveResult } from "@/app/actions/weave";
import { Overview, RegionList, SearchResults, ThemeList, type WeaveState } from "./brain-panels";
import { NoteDetail, type NotePatch } from "./note-detail";
import { useDictation } from "./use-dictation";
import { CAPTURED_EVENT, LINKED_EVENT, classifyThought } from "./classify-client";
import type { GraphEdge, GraphNode } from "./note-graph";
import { toast } from "@/components/ui/toaster";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const BrainScene = dynamic(() => import("./brain-scene").then((mod) => mod.BrainScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Brain className="h-8 w-8 animate-pulse text-accent" />
    </div>
  ),
});

type View =
  | { kind: "overview" }
  | { kind: "region"; region: BrainCategoryId }
  | { kind: "theme"; key: string }
  | { kind: "note"; id: string };

const tempId = () => `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * A server action rejects on a dropped connection rather than returning an
 * error. Without this, every optimistic update would stay on screen after the
 * server refused it — the UI showing a state the database doesn't have.
 */
async function safe<T>(action: Promise<BrainResult<T>>): Promise<BrainResult<T>> {
  try {
    return await action;
  } catch {
    return { ok: false, code: "failed", error: "network" };
  }
}

/** Adds links not already present (by pair), keeping the existing ones. */
function mergeLinks(prev: BrainLink[], incoming: BrainLink[]): BrainLink[] {
  const have = new Set(prev.map((l) => pairKey(l.fromId, l.toId)));
  const fresh = incoming.filter((l) => !have.has(pairKey(l.fromId, l.toId)));
  return fresh.length ? [...prev, ...fresh] : prev;
}

export function SecondBrain({
  initialNotes,
  initialLinks,
  initialDismissed,
  linksAvailable,
  synapses,
  aiEnabled,
  initialNoteId,
  nowIso,
  seed,
}: {
  initialNotes: BrainNote[];
  initialLinks: BrainLink[];
  /** Pairs the person said are not related, as `pairKey`s. */
  initialDismissed: string[];
  /** False until migration 007 creates the links table. */
  linksAvailable: boolean;
  /** Migration 008: typed connections, concepts, dismissals. */
  synapses: boolean;
  /** An AI provider is configured. */
  aiEnabled: boolean;
  /** Opened straight away — a link from the assistant or the agent. */
  initialNoteId?: string | null;
  /** Server time, so server and client compute the same focus and resurfacing. */
  nowIso: string;
  /** Per-user salt for today's resurfaced note. */
  seed: string;
}) {
  const m = useMessages();
  const locale = useLocale();

  const [notes, setNotes] = useState(initialNotes);
  const [links, setLinks] = useState(initialLinks);
  const [dismissed, setDismissed] = useState(() => new Set(initialDismissed));
  const [view, setView] = useState<View>(() =>
    initialNoteId && initialNotes.some((n) => n.id === initialNoteId)
      ? { kind: "note", id: initialNoteId }
      : { kind: "overview" }
  );
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [weaveState, setWeaveState] = useState<WeaveState>({ phase: "idle" });
  const searchRef = useRef<HTMLInputElement>(null);
  // A synchronous lock. `capturing` is React state and updates asynchronously,
  // so two quick Enters could both read `false` and save the thought twice.
  const captureLock = useRef(false);

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const errorText = useCallback((code: BrainErrorCode) => m.brain.errors[code], [m]);
  const weaveBlocked: null | "noAi" | "pending" = !aiEnabled ? "noAi" : !synapses ? "pending" : null;

  // Notes and connections made elsewhere — the topbar capture, and the
  // weaving that follows it — join the brain without a reload.
  useEffect(() => {
    const onCaptured = (e: Event) => {
      const note = (e as CustomEvent<BrainNote>).detail;
      if (note?.id) setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [note, ...prev]));
    };
    const onLinked = (e: Event) => {
      const incoming = (e as CustomEvent<BrainLink[]>).detail;
      if (Array.isArray(incoming)) setLinks((prev) => mergeLinks(prev, incoming));
    };
    window.addEventListener(CAPTURED_EVENT, onCaptured);
    window.addEventListener(LINKED_EVENT, onLinked);
    return () => {
      window.removeEventListener(CAPTURED_EVENT, onCaptured);
      window.removeEventListener(LINKED_EVENT, onLinked);
    };
  }, []);

  // The migration warnings are for whoever operates the workspace, not the
  // user, who sees a plain sentence instead.
  useEffect(() => {
    if (!linksAvailable) {
      console.warn("[LifeOS] Connections are off: apply supabase/migrations/007_second_brain.sql to enable them.");
    } else if (!synapses) {
      console.warn("[LifeOS] Typed connections are off: apply supabase/migrations/008_synapses.sql to enable them.");
    }
  }, [linksAvailable, synapses]);

  /* ── Derived ──────────────────────────────────────────────────── */

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const focus = useMemo(() => computeFocus({ notes, links, now }), [notes, links, now]);
  const resurfaced = useMemo(() => pickResurface({ notes, links, now, seed }), [notes, links, now, seed]);
  const results = useMemo(() => (query.trim() ? searchNotes(notes, query) : []), [notes, query]);
  const themeList = useMemo(() => findThemes(notes), [notes]);

  const openNote = view.kind === "note" ? byId.get(view.id) ?? null : null;
  const openTheme = useMemo(() => {
    if (view.kind !== "theme") return null;
    // A theme opened from a note's subjects may be shared by that note alone.
    const found = findThemes(notes, { min: 1, limit: 1000 }).find((t) => t.key === view.key);
    return found ?? null;
  }, [view, notes]);

  // The scene draws the most recent notes. Past a few hundred, a brain becomes
  // noise rather than a map; everything stays reachable through search.
  const rendered = useMemo(
    () => [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_RENDERED_NODES),
    [notes]
  );
  const nodes: GraphNode[] = useMemo(
    () =>
      rendered.map((n) => {
        const cat = categoryById(n.category);
        return {
          id: n.id,
          title: n.title,
          position: nodePosition(n.id, cat.anchor),
          color: cat.color,
          done: n.done,
          dim:
            (view.kind === "region" && n.category !== view.region) ||
            (view.kind === "theme" && !(openTheme?.noteIds.includes(n.id) ?? false)),
        };
      }),
    [rendered, view, openTheme]
  );
  const edges: GraphEdge[] = useMemo(() => {
    const pos = new Map(nodes.map((n) => [n.id, n.position]));
    const sel = openNote?.id;
    return links
      .filter((l) => pos.has(l.fromId) && pos.has(l.toId))
      .map((l) => ({
        from: pos.get(l.fromId)!,
        to: pos.get(l.toId)!,
        active: l.fromId === sel || l.toId === sel,
        color: RELATION_COLOR[l.kind],
        pending: isUnreviewed(l.origin),
      }));
  }, [nodes, links, openNote?.id]);

  const labels = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, m.brain.cat[c.id].label])) as Record<BrainCategoryId, string>,
    [m]
  );

  /* ── Navigation ───────────────────────────────────────────────── */

  const open = useCallback((id: string) => {
    setQuery("");
    setView({ kind: "note", id });
  }, []);

  const back = useCallback(() => {
    setView((v) => {
      if (v.kind === "note") {
        const n = byId.get(v.id);
        return n ? { kind: "region", region: n.category } : { kind: "overview" };
      }
      return { kind: "overview" };
    });
  }, [byId]);

  const toggleRegion = useCallback((region: BrainCategoryId) => {
    setQuery("");
    setView((v) => (v.kind === "region" && v.region === region ? { kind: "overview" } : { kind: "region", region }));
  }, []);

  const openThemeView = useCallback((key: string) => {
    setQuery("");
    setView({ kind: "theme", key });
  }, []);

  // "/" to search, Escape to step back — without stealing keys from inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && !typing) {
        if (query) setQuery("");
        else back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, back]);

  /* ── Weaving ──────────────────────────────────────────────────── */

  /** What a weaving run found: new connections, and what the notes it read are about. */
  const absorb = useCallback((report: WeaveResult) => {
    setLinks((prev) => mergeLinks(prev, report.created));
    const read = report.concepts;
    if (Object.keys(read).length > 0) {
      setNotes((prev) => prev.map((n) => (read[n.id] ? { ...n, concepts: read[n.id] } : n)));
    }
  }, []);

  /** "Connected — moves forward “Sign 10 clients”", from the woven note's side. */
  const announce = useCallback(
    (created: BrainLink[], around?: string) => {
      if (created.length === 0) return;
      if (created.length > 1 || !around) return toast(plural(locale, created.length, m.brain.weave.created));
      const l = created[0];
      const otherId = l.fromId === around ? l.toId : l.fromId;
      const other = byId.get(otherId);
      if (!other) return toast(plural(locale, 1, m.brain.weave.created));
      toast(
        fill(m.brain.weave.linked, {
          relation: relationText(l.kind, perspective(l.kind, around, l.sourceId), m).toLowerCase(),
          title: other.title,
        })
      );
    },
    [byId, locale, m]
  );

  /**
   * Connects notes just written. Runs after the note is saved and shown, so a
   * capture never waits for a model. A rate limit or a failure here is
   * silent: the note is safe, and "organise my brain" catches up later.
   */
  const weaveAround = useCallback(
    async (ids: string[]): Promise<WeaveResult | null> => {
      if (weaveBlocked || ids.length === 0) return null;
      const res = await safe(weaveNotes(ids));
      if (!res.ok) return null;
      absorb(res.data);
      return res.data;
    },
    [weaveBlocked, absorb]
  );

  const organise = useCallback(async () => {
    if (weaveBlocked) return;
    setWeaveState({ phase: "running" });
    const res = await safe(weaveBrain());
    if (!res.ok) {
      setWeaveState({ phase: "done", created: 0, analysed: 0, stopped: "failed" });
      return;
    }
    absorb(res.data);
    setWeaveState({
      phase: "done",
      created: res.data.created.length,
      analysed: res.data.analysed,
      stopped: res.data.stopped,
    });
  }, [weaveBlocked, absorb]);

  const findLinks = useCallback(
    async (id: string) => {
      const report = await weaveAround([id]);
      if (!report) return void toast(m.brain.errors.failed, "error");
      if (report.stopped === "rate_limit") return void toast(m.brain.weave.rateLimited, "error");
      if (report.stopped === "failed") return void toast(m.brain.weave.failed, "error");
      if (report.created.length === 0) return void toast(m.brain.links.noneFound);
      announce(report.created, id);
    },
    [weaveAround, announce, m]
  );

  /* ── Mutations — optimistic, rolled back on failure ───────────── */

  const capture = useCallback(
    async (text?: string) => {
      const title = (text ?? draft).trim();
      if (!title || captureLock.current) return;
      captureLock.current = true;
      setDraft("");
      setCapturing(true);

      const temp: BrainNote = {
        id: tempId(),
        category: "thoughts",
        kind: "thought",
        title,
        detail: null,
        done: false,
        ai: false,
        createdAt: new Date().toISOString(),
        concepts: [],
      };
      setNotes((prev) => [temp, ...prev]);

      // Classification only. The person's words are saved exactly as written.
      const category = await classifyThought(title, locale);

      const saved = await safe(createNote({ title, category }));
      // `safe` never throws, so the lock is always released — one network
      // blip can't leave capture disabled until the page is reloaded.
      captureLock.current = false;
      setCapturing(false);
      if (saved.ok) {
        // Built field by field: the server row also carries the owner key,
        // which has no business in client state.
        const real: BrainNote = {
          id: saved.data.id,
          category,
          kind: saved.data.kind,
          title,
          detail: saved.data.detail,
          done: saved.data.done,
          ai: saved.data.ai,
          createdAt: saved.data.createdAt,
          concepts: [],
        };
        setNotes((prev) => prev.map((n) => (n.id === temp.id ? real : n)));
        toast(`${m.brain.captured} · ${m.brain.cat[category].label}`);
        void weaveAround([real.id]).then((report) => report && announce(report.created, real.id));
      } else {
        setNotes((prev) => prev.filter((n) => n.id !== temp.id));
        setDraft(title); // give the words back rather than lose them
        toast(errorText(saved.code), "error");
      }
    },
    [draft, locale, m, errorText, weaveAround, announce]
  );

  const update = useCallback(
    async (id: string, patch: NotePatch) => {
      const before = byId.get(id);
      if (!before) return;
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
      const res = await safe(updateNote(id, patch));
      if (!res.ok) {
        setNotes((prev) => prev.map((n) => (n.id === id ? before : n)));
        toast(errorText(res.code), "error");
      }
    },
    [byId, errorText]
  );

  const remove = useCallback(
    async (id: string) => {
      const prevNotes = notes;
      const prevLinks = links;
      const gone = byId.get(id);
      setNotes((p) => p.filter((n) => n.id !== id));
      setLinks((p) => p.filter((l) => l.fromId !== id && l.toId !== id));
      setView(gone ? { kind: "region", region: gone.category } : { kind: "overview" });
      const res = await safe(deleteNote(id));
      if (res.ok) toast(m.brain.note.deleted);
      else {
        setNotes(prevNotes);
        setLinks(prevLinks);
        toast(errorText(res.code), "error");
      }
    },
    [notes, links, byId, m, errorText]
  );

  const link = useCallback(
    async (a: string, b: string, origin: "user" | "suggested", reason?: string) => {
      if (!linksAvailable) return toast(m.brain.links.unavailable, "error");
      const [fromId, toId] = canonicalPair(a, b);
      const temp: BrainLink = { id: tempId(), fromId, toId, reason: reason ?? null, origin, kind: "related", sourceId: null };
      setLinks((p) => [...p, temp]);
      const res = await safe(linkNotes({ a, b, reason, origin }));
      if (res.ok) {
        // An idempotent re-link returns the existing row; don't list it twice.
        setLinks((p) => [...p.filter((l) => l.id !== temp.id && l.id !== res.data.id), res.data]);
        toast(m.brain.links.connected);
      } else {
        setLinks((p) => p.filter((l) => l.id !== temp.id));
        toast(errorText(res.code), "error");
      }
    },
    [linksAvailable, m, errorText]
  );

  /** Removing a connection is remembered, so the engine never redraws it. */
  const unlink = useCallback(
    async (linkId: string) => {
      const prev = links;
      const gone = links.find((l) => l.id === linkId);
      setLinks((p) => p.filter((l) => l.id !== linkId));
      if (gone && synapses) setDismissed((d) => new Set(d).add(pairKey(gone.fromId, gone.toId)));
      const res = await safe(unlinkNotes(linkId));
      if (!res.ok) {
        setLinks(prev);
        toast(errorText(res.code), "error");
      }
    },
    [links, synapses, errorText]
  );

  const review = useCallback(
    async (linkId: string, decision: "keep" | "remove") => {
      if (decision === "remove") {
        await unlink(linkId);
        return void toast(m.brain.review.removed);
      }
      const prev = links;
      setLinks((p) => p.map((l) => (l.id === linkId ? { ...l, origin: "suggested" } : l)));
      const res = await safe(reviewLink(linkId, "keep"));
      if (res.ok) toast(m.brain.review.kept);
      else {
        setLinks(prev);
        toast(errorText(res.code), "error");
      }
    },
    [links, unlink, m, errorText]
  );

  const retype = useCallback(
    async (linkId: string, kind: RelationKind) => {
      const prev = links;
      setLinks((p) => p.map((l) => (l.id === linkId ? { ...l, kind } : l)));
      const res = await safe(retypeLink(linkId, kind));
      if (res.ok) setLinks((p) => p.map((l) => (l.id === linkId ? res.data : l)));
      else {
        setLinks(prev);
        toast(errorText(res.code), "error");
      }
    },
    [links, errorText]
  );

  const dismiss = useCallback(
    async (a: string, b: string) => {
      const key = pairKey(a, b);
      setDismissed((d) => new Set(d).add(key));
      const res = await safe(dismissPair(a, b));
      if (res.ok) toast(m.brain.links.dismissed);
      else {
        setDismissed((d) => {
          const next = new Set(d);
          next.delete(key);
          return next;
        });
        toast(errorText(res.code), "error");
      }
    },
    [m, errorText]
  );

  const adoptSteps = useCallback(
    async (id: string, steps: string[]): Promise<boolean> => {
      const res = await safe(adoptNextSteps({ id, steps }));
      if (!res.ok) {
        toast(errorText(res.code), "error");
        return false;
      }
      setNotes((prev) => [...res.data.notes, ...prev]);
      setLinks((prev) => mergeLinks(prev, res.data.links));
      toast(plural(locale, res.data.notes.length, m.brain.develop.added));
      return true;
    },
    [errorText, locale, m]
  );

  /* ── Dictation ────────────────────────────────────────────────── */

  const dictation = useDictation({
    locale,
    onText: (text, final) => {
      setDraft(text);
      if (final && text) void capture(text);
    },
    onError: (e) => toast(e === "denied" ? m.brain.voiceDenied : m.brain.voiceError, "error"),
  });

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    // Side by side only from 1280px: on a laptop with the sidebar open, a
    // 1024px window left the brain a 350px sliver next to the panel.
    <div className="grid overflow-hidden rounded-xl border border-border bg-surface xl:grid-cols-[1fr_390px]">
      {/* 3D stage */}
      <div className="relative min-h-[52vh] xl:min-h-[74vh]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(58% 58% at 50% 42%, rgba(34,211,238,0.12), transparent 72%)" }}
        />
        <div className="absolute inset-0">
          <BrainScene
            // The region marker only lights up when a region is what's being
            // browsed; with a note open, its own label says enough.
            selectedRegion={view.kind === "region" ? view.region : null}
            onSelectRegion={toggleRegion}
            labels={labels}
            nodes={nodes}
            edges={edges}
            selectedNoteId={openNote?.id ?? null}
            onSelectNote={open}
          />
        </div>

        {/* One column, top left: nothing on the stage can overlap it. */}
        <div className="pointer-events-none absolute left-5 top-5 max-w-[70%]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4 text-accent" /> {m.nav.brain}
          </div>
          <p className="mt-1 font-mono text-[0.72rem] text-muted-foreground">
            {plural(locale, notes.length, m.brain.hudNotes)} · {plural(locale, links.length, m.brain.hudLinks)}
          </p>
          <p className="mt-1 hidden text-[0.68rem] text-muted sm:block">{m.brain.hint}</p>
          {links.length > 0 && (
            <ul className="mt-2 hidden flex-wrap gap-x-2.5 gap-y-1 sm:flex" aria-label={m.brain.links.kind}>
              {(Object.keys(RELATION_COLOR) as RelationKind[])
                .filter((k) => links.some((l) => l.kind === k))
                .map((k) => (
                  <li key={k} className="flex items-center gap-1 text-[0.64rem] text-muted-foreground">
                    <span className="h-0.5 w-3 rounded-full" style={{ background: RELATION_COLOR[k] }} />
                    {m.brain.relationName[k]}
                  </li>
                ))}
            </ul>
          )}
        </div>

        {/* Capture */}
        <form
          className="absolute inset-x-4 bottom-4"
          onSubmit={(e) => {
            e.preventDefault();
            void capture();
          }}
        >
          <div className="mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-border bg-surface/85 px-3 py-1.5 backdrop-blur focus-within:border-border-strong">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Handled here, like every other text field in the app, rather
                // than left to implicit form submission. Skipped while an input
                // method is composing: there Enter confirms the accent or the
                // character, it doesn't mean "send".
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void capture();
                }
              }}
              placeholder={dictation.listening ? m.brain.voiceListening : m.brain.capturePlaceholder}
              aria-label={m.brain.capturePlaceholder}
              maxLength={500}
              className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {dictation.supported && (
              <button
                type="button"
                onClick={dictation.listening ? dictation.stop : dictation.start}
                aria-label={dictation.listening ? m.brain.voiceStop : m.brain.voiceStart}
                aria-pressed={dictation.listening}
                title={`${dictation.listening ? m.brain.voiceStop : m.brain.voiceStart} — ${m.brain.voiceDisclosure}`}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-md transition-colors",
                  dictation.listening ? "bg-danger/15 text-danger" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {dictation.listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <button
              type="submit"
              disabled={!draft.trim() || capturing}
              className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
              aria-label={m.brain.capture}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>

      {/* Side panel */}
      <aside className="flex min-h-0 flex-col border-t border-border xl:max-h-[74vh] xl:border-l xl:border-t-0">
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-2.5 focus-within:border-border-strong">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.brain.searchPlaceholder}
              aria-label={m.brain.searchPlaceholder}
              className="h-8 flex-1 bg-transparent text-[0.82rem] outline-none placeholder:text-muted"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label={m.brain.back} className="text-muted hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="rounded border border-border px-1 font-mono text-[0.62rem] text-muted">/</kbd>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <AnimatePresence mode="wait">
            {query.trim() ? (
              <SearchResults key="search" query={query} results={results} onOpen={open} />
            ) : openNote ? (
              <NoteDetail
                key={`note-${openNote.id}`}
                note={openNote}
                notes={notes}
                links={links}
                dismissed={dismissed}
                linksAvailable={linksAvailable}
                synapses={synapses}
                aiEnabled={aiEnabled}
                onBack={back}
                onOpen={open}
                onTheme={openThemeView}
                onUpdate={update}
                onDelete={remove}
                onLink={link}
                onUnlink={unlink}
                onReview={review}
                onRetype={retype}
                onDismiss={dismiss}
                onFindLinks={findLinks}
                onAdoptSteps={adoptSteps}
              />
            ) : view.kind === "theme" && openTheme ? (
              <ThemeList key={`theme-${openTheme.key}`} theme={openTheme} notes={notes} onOpen={open} onBack={back} />
            ) : view.kind === "region" ? (
              <RegionList key={`region-${view.region}`} region={view.region} notes={notes} onOpen={open} onBack={back} />
            ) : (
              <Overview
                key="overview"
                notes={notes}
                links={links}
                focus={focus}
                resurfaced={resurfaced}
                themes={themeList}
                now={now}
                weave={weaveState}
                weaveBlocked={weaveBlocked}
                onOpen={open}
                onRegion={toggleRegion}
                onTheme={openThemeView}
                onReview={review}
                onWeave={organise}
              />
            )}
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}
