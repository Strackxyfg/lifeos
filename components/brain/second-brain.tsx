"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { ArrowUp, AudioLines, Brain, History, Loader2, Mic, Pause, Play, Search, Sparkles, Square, X } from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import { canonicalPair, pairKey, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { computeFocus } from "@/lib/brain/focus";
import { pickResurface } from "@/lib/brain/resurface";
import { searchNotes } from "@/lib/brain/search";
import { themes as findThemes } from "@/lib/brain/concepts";
import { mindMap } from "@/lib/brain/mindmap";
import { MAX_RENDERED_NODES, nodePosition } from "@/lib/brain/layout";
import { RELATION_COLOR, isUnreviewed, perspective, type RelationKind } from "@/lib/brain/relations";
import { relationText } from "@/lib/brain/labels";
import {
  createNote, deleteNote, dismissPair, linkNotes, retypeLink, reviewLink, unlinkNotes, updateNote,
  type BrainErrorCode, type BrainResult,
} from "@/app/actions/brain";
import { adoptNextSteps, weaveBrain, weaveNotes, type WeaveResult } from "@/app/actions/weave";
import { ConstellationList, Overview, RegionList, SearchResults, ThemeList, type WeaveState } from "./brain-panels";
import { NoteDetail, type NotePatch } from "./note-detail";
import { BrainDump, Meter } from "./brain-dump";
import { MAX_RECORDING_MS } from "./use-recorder";
import { audioFile } from "@/components/voice/transcribe-client";
import { DUMP_HANDOFF } from "./share-capture";
import { hash } from "@/lib/brain/text";
import { BrainAnswer } from "./brain-answer";
import { ReviewCard } from "./review-card";
import { TensionDecision, type Decided } from "./tension-decision";
import { DAILY_REVIEWS, reviewQueue, schedule, type ReviewAnswer } from "@/lib/brain/review";
import { dayKey } from "@/lib/brain/resurface";
import { beatFor, replayEvents, visibleAt } from "@/lib/brain/replay";
import { reviewNote } from "@/app/actions/memory";
import type { ThoughtTrace } from "@/lib/brain/context";
import { useDictation } from "./use-dictation";
import { useRecorder } from "./use-recorder";
import { transcribeAudio } from "@/components/voice/transcribe-client";

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
import { useSpeech } from "@/components/voice/use-speech";
import { getVoicePrefs, speechSupported, stopSpeaking, unlockSpeech } from "@/lib/voice/speaker";
import { CONVERSATION_VAD } from "@/lib/voice/vad";
import { CAPTURED_EVENT, LINKED_EVENT, OPEN_DUMP_EVENT, classifyThought } from "./classify-client";
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
  | { kind: "constellation"; id: string }
  | { kind: "note"; id: string }
  /** The brain dump, with the text it opens with. */
  | { kind: "dump"; text: string }
  /** A question asked of the brain. */
  /** A question asked of the brain; `seq` makes asking the same question twice a new answer. */
  | { kind: "ask"; question: string; seq: number; voice: boolean }
  /** Deciding a tension. */
  | { kind: "decide"; linkId: string };

/** A paste this long, or on several lines, is a dump rather than one thought. */
const isDump = (text: string) => text.includes("\n") || text.length > 280;

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
  memory,
  aiEnabled,
  voiceEnabled,
  initialNoteId,
  initialDump,
  initialDecide,
  initialRegion,
  double,
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
  /** Migration 009: spaced review, decided tensions. */
  memory: boolean;
  /** An AI provider is configured. */
  aiEnabled: boolean;
  /** A transcription provider is configured, for voice memos. */
  voiceEnabled: boolean;
  /** Opened straight away — a link from the assistant or the agent. */
  initialNoteId?: string | null;
  /** Opens on the brain dump — from the command menu. */
  initialDump?: boolean;
  /** Opens on a tension's decision — from the double's advice. */
  initialDecide?: string | null;
  /** Opens on a region — from the double's advice. */
  initialRegion?: BrainCategoryId | null;
  /** The double's card, at the top of the overview. */
  double?: ReactNode;
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
    initialDump
      ? { kind: "dump", text: "" }
      : initialNoteId && initialNotes.some((n) => n.id === initialNoteId)
        ? { kind: "note", id: initialNoteId }
        : initialDecide && initialLinks.some((l) => l.id === initialDecide && l.kind === "tension")
          ? { kind: "decide", linkId: initialDecide }
          : initialRegion
            ? { kind: "region", region: initialRegion }
            : { kind: "overview" }
  );
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [weaveState, setWeaveState] = useState<WeaveState>({ phase: "idle" });
  // How the brain read the question being answered, drawn in 3D. `run`
  // restarts the drawing when the person replays it.
  const [trace, setTrace] = useState<{ data: ThoughtTrace; run: number } | null>(null);
  // Reviews answered since the page opened: today's batch shrinks with them.
  const [answered, setAnswered] = useState(0);
  // The conversation in the ask view: earlier questions and answers, the
  // answer just written (it joins them when the next question is asked), and
  // a counter so asking the same question twice fetches a new answer.
  const [turns, setTurns] = useState<{ q: string; a: string }[]>([]);
  const lastAnswer = useRef<{ q: string; a: string } | null>(null);
  const askSeq = useRef(0);
  // The brain's growth, replayed: how many events have played, and whether it runs.
  const [replay, setReplay] = useState<{ count: number; playing: boolean } | null>(null);
  // How the neurons are coloured: by region (what a note is) or by
  // constellation (what it belongs with).
  const [colorBy, setColorBy] = useState<"region" | "constellation">("region");
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
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
    const onDump = () => openDump("");
    window.addEventListener(CAPTURED_EVENT, onCaptured);
    window.addEventListener(LINKED_EVENT, onLinked);
    window.addEventListener(OPEN_DUMP_EVENT, onDump);
    return () => {
      window.removeEventListener(CAPTURED_EVENT, onCaptured);
      window.removeEventListener(LINKED_EVENT, onLinked);
      window.removeEventListener(OPEN_DUMP_EVENT, onDump);
    };
    // `openDump` is stable: it only uses state setters and a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A long text shared from another app waits in session storage — a URL
  // could not carry it — and opens here in the dump.
  useEffect(() => {
    if (!initialDump) return;
    try {
      const shared = sessionStorage.getItem(DUMP_HANDOFF);
      if (shared) {
        sessionStorage.removeItem(DUMP_HANDOFF);
        setView({ kind: "dump", text: shared });
      }
    } catch {
      // Storage unavailable: the dump opens empty.
    }
  }, [initialDump]);

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
  const today = dayKey(now);
  const queue = useMemo(
    () => reviewQueue({ notes: notes.filter((n) => !n.id.startsWith("temp-")), today, limit: Math.max(0, DAILY_REVIEWS - answered) }),
    [notes, today, answered]
  );
  const results = useMemo(() => (query.trim() ? searchNotes(notes, query) : []), [notes, query]);
  const themeList = useMemo(() => findThemes(notes), [notes]);
  // The shape of the brain. Pure and on the device; recomputed only when
  // notes or connections change.
  const map = useMemo(() => mindMap({ notes: notes.filter((n) => !n.id.startsWith("temp-")), links }), [notes, links]);
  const openConstellation =
    view.kind === "constellation" ? map.constellations.find((c) => c.id === view.id) ?? null : null;
  const constellationColor = useMemo(
    () => new Map(map.constellations.flatMap((c) => c.noteIds.map((id) => [id, c.color] as const))),
    [map]
  );

  const viewRef = useRef(view);
  viewRef.current = view;
  const openNote = view.kind === "note" ? byId.get(view.id) ?? null : null;
  const decisionView = useMemo(() => {
    if (view.kind !== "decide") return null;
    const link = links.find((l) => l.id === view.linkId);
    const a = link && byId.get(link.fromId);
    const b = link && byId.get(link.toId);
    return link && a && b ? { link, a, b } : null;
  }, [view, links, byId]);

  // A trace belongs to its answer: leaving the answer puts the brain back.
  useEffect(() => {
    if (view.kind !== "ask") setTrace(null);
  }, [view.kind]);
  const traced = useMemo(() => {
    if (!trace) return null;
    const d = trace.data;
    return {
      ids: new Set([...d.seeds.map((s) => s.id), ...d.hops.map((h) => h.to), ...d.context]),
      pairs: new Set(d.hops.map((h) => pairKey(h.from, h.to))),
    };
  }, [trace]);
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
  const replaying = replay !== null;
  const events = useMemo(
    () => (replaying ? replayEvents(notes.filter((n) => !n.id.startsWith("temp-")), links) : []),
    [replaying, notes, links]
  );
  const visible = useMemo(() => (replay ? visibleAt(events, replay.count) : null), [replay, events]);

  // One event per beat; the replay stops on the whole brain.
  useEffect(() => {
    if (!replay?.playing) return;
    const timer = window.setInterval(() => {
      setReplay((r) => (!r ? r : r.count >= events.length ? { ...r, playing: false } : { ...r, count: r.count + 1 }));
    }, beatFor(events.length));
    return () => window.clearInterval(timer);
  }, [replay?.playing, events.length]);

  const startReplay = useCallback(() => {
    setQuery("");
    setView({ kind: "overview" });
    // With reduced motion, the replay opens on the whole brain, to scrub by hand.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReplay({ count: still ? Number.MAX_SAFE_INTEGER : 0, playing: !still });
  }, []);

  const nodes: GraphNode[] = useMemo(
    () =>
      (visible ? rendered.filter((n) => visible.notes.has(n.id)) : rendered).map((n) => {
        const cat = categoryById(n.category);
        const inOpen = openConstellation ? openConstellation.noteIds.includes(n.id) : true;
        return {
          id: n.id,
          title: n.title,
          // Positions stay by region either way: the brain keeps its shape,
          // only the colours say which universe a note belongs to.
          position: nodePosition(n.id, cat.anchor),
          color: colorBy === "constellation" || openConstellation ? constellationColor.get(n.id) ?? "#64748b" : cat.color,
          done: n.done,
          dim: traced
            ? !traced.ids.has(n.id)
            : (view.kind === "region" && n.category !== view.region) ||
              (view.kind === "theme" && !(openTheme?.noteIds.includes(n.id) ?? false)) ||
              !inOpen,
        };
      }),
    [rendered, view, openTheme, openConstellation, colorBy, constellationColor, traced, visible]
  );
  // Where each drawn note sits, for the trace. From `rendered`, not `nodes`:
  // dimming for the trace must not restart it.
  const positions = useMemo(
    () => new Map(rendered.map((n) => [n.id, nodePosition(n.id, categoryById(n.category).anchor)] as const)),
    [rendered]
  );
  const edges: GraphEdge[] = useMemo(() => {
    const pos = new Map(nodes.map((n) => [n.id, n.position]));
    const sel = openNote?.id;
    return links
      .filter((l) => pos.has(l.fromId) && pos.has(l.toId) && (!visible || visible.links.has(l.id)))
      .map((l) => ({
        from: pos.get(l.fromId)!,
        to: pos.get(l.toId)!,
        // With a trace drawn, the connections it followed are the lit ones.
        active: traced ? traced.pairs.has(pairKey(l.fromId, l.toId)) : l.fromId === sel || l.toId === sel,
        color: RELATION_COLOR[l.kind],
        pending: isUnreviewed(l.origin),
      }));
  }, [nodes, links, openNote?.id, traced, visible]);

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

  const openConstellationView = useCallback((id: string) => {
    setQuery("");
    setView({ kind: "constellation", id });
  }, []);

  const openThemeView = useCallback((key: string) => {
    setQuery("");
    setView({ kind: "theme", key });
  }, []);

  const ask = useCallback((question: string, voice = false) => {
    const q = question.trim();
    if (q.length < 2) return;
    // A question asked while an answer is open continues that conversation;
    // asked from anywhere else, it starts a new one.
    const answered = lastAnswer.current;
    lastAnswer.current = null;
    if (viewRef.current.kind === "ask") {
      if (answered) setTurns((t) => [...t, answered].slice(-6));
    } else {
      setTurns([]);
    }
    // Safari speaks only after a gesture: this call comes from one.
    if (!voice && getVoicePrefs().autoRead) unlockSpeech();
    askSeq.current += 1;
    setQuery("");
    setTrace(null);
    setView({ kind: "ask", question: q, seq: askSeq.current, voice });
    if (window.matchMedia("(max-width: 1279px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  /* ── Talking to the brain ─────────────────────────────────────── */

  // Hands-free: listen until the question is over, transcribe it, ask it,
  // read the answer aloud while the brain shows how it read it — then listen
  // again, until the person stops or says nothing. Never listens while the
  // answer is being read: the device's voice is not always removed by the
  // browser's echo cancellation, and the brain would hear itself.
  const [talk, setTalk] = useState<null | { phase: "listening" | "transcribing" | "thinking"; heard?: string }>(null);
  const talkRef = useRef(talk);
  talkRef.current = talk;
  const noteRecordingRef = useRef(false);
  const speech = useSpeech();
  const talkRecorder = useRecorder({
    autoStop: CONVERSATION_VAD,
    onRecorded: (audio) => void heardQuestion(audio),
    onSilence: () => {
      setTalk(null);
      toast(m.brain.talk.ended);
    },
    onError: (e) => {
      setTalk(null);
      toast(m.brain.dump.errors[e], "error");
    },
  });
  const talkRec = useRef(talkRecorder);
  talkRec.current = talkRecorder;

  const listen = useCallback(() => {
    setTalk({ phase: "listening" });
    void talkRec.current.start();
  }, []);

  async function heardQuestion(audio: Blob) {
    if (!talkRef.current) return;
    setTalk({ phase: "transcribing" });
    const r = await transcribeAudio(audio, locale);
    if (!talkRef.current) return; // ended while transcribing
    if ("error" in r) {
      if (r.error === "empty") return listen();
      setTalk(null);
      return void toast(m.brain.dump.errors[r.error], "error");
    }
    setTalk({ phase: "thinking", heard: r.text });
    ask(r.text, true);
  }

  const startTalk = useCallback(() => {
    // One microphone at a time: not while a voice note is being recorded.
    if (noteRecordingRef.current) return;
    // Called from the click: unlock the voice now, it will speak later.
    unlockSpeech();
    stopSpeaking();
    listen();
  }, [listen]);

  /** The answer has been read: the brain listens for what comes next. */
  const answerSpoken = useCallback(() => {
    if (talkRef.current) listen();
  }, [listen]);

  const interruptTalk = useCallback(() => {
    stopSpeaking();
    if (talkRef.current) listen();
  }, [listen]);

  const endTalk = useCallback(() => {
    talkRec.current.cancel();
    stopSpeaking();
    setTalk(null);
  }, []);

  const decide = useCallback((linkId: string) => {
    setQuery("");
    setView({ kind: "decide", linkId });
    if (window.matchMedia("(max-width: 1279px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  function openDump(text: string) {
    setQuery("");
    setView({ kind: "dump", text });
    // Below 1280px the panel sits under the stage: bring it into view.
    if (window.matchMedia("(max-width: 1279px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  // "/" to search, Escape to step back — without stealing keys from inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && talkRef.current) {
        endTalk();
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
      const temp: BrainLink = { id: tempId(), fromId, toId, reason: reason ?? null, origin, kind: "related", sourceId: null, resolvedBy: null };
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

  /**
   * A review answer, applied at once: the note leaves today's queue as soon
   * as its next date moves. "Rework" opens the note, since that is the point.
   */
  const answerReview = useCallback(
    async (id: string, answer: ReviewAnswer) => {
      const before = byId.get(id);
      if (!before) return;
      const next = schedule(before, answer, today, new Date().toISOString());
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...next, done: next.done ?? n.done } : n)));
      setAnswered((a) => a + 1);
      if (answer === "rework") setView({ kind: "note", id });
      const res = await safe(reviewNote(id, answer));
      if (!res.ok) {
        setNotes((prev) => prev.map((n) => (n.id === id ? before : n)));
        setAnswered((a) => Math.max(0, a - 1));
        toast(errorText(res.code), "error");
      }
    },
    [byId, today, errorText]
  );

  /** A decision recorded: the note joins the brain, the tension shows as decided, and the decision opens. */
  const decided = useCallback((d: Decided) => {
    setNotes((prev) => [d.note, ...prev.map((n) => (d.archived.includes(n.id) ? { ...n, done: true } : n))]);
    setLinks((prev) => mergeLinks(prev.map((l) => (l.id === d.tension.id ? d.tension : l)), d.links));
    setView({ kind: "note", id: d.note.id });
  }, []);

  /** The notes a dump added: shown at once, then woven into the rest of the brain. */
  const dumpSaved = useCallback(
    (added: BrainNote[], created: BrainLink[]) => {
      setNotes((prev) => [...added, ...prev]);
      setLinks((prev) => mergeLinks(prev, created));
      setView({ kind: "overview" });
      toast(
        created.length > 0
          ? `${plural(locale, added.length, m.brain.dump.added)} · ${plural(locale, created.length, m.brain.hudLinks)}`
          : plural(locale, added.length, m.brain.dump.added)
      );
      if (added.length > 0) void weaveAround(added.map((n) => n.id)).then((report) => report && announce(report.created));
    },
    [locale, m, weaveAround, announce]
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

  /* ── Voice notes ──────────────────────────────────────────────── */

  // The capture bar's microphone records a voice note: transcribed word by
  // word and kept, so the note plays back with each word lit as it is said.
  // Where recordings cannot be transcribed, the browser's dictation stands in.
  const [voiceSaving, setVoiceSaving] = useState(false);
  const noteRecorder = useRecorder({
    onRecorded: (audio) => void saveVoiceNote(audio),
    onError: (e) => toast(m.brain.dump.errors[e], "error"),
  });
  noteRecordingRef.current = noteRecorder.recording;
  const voiceNotes = voiceEnabled && noteRecorder.supported;

  async function saveVoiceNote(audio: Blob) {
    setVoiceSaving(true);
    const form = new FormData();
    form.append("audio", audioFile(audio));
    form.append("locale", locale);
    let ok = false;
    let data: { note?: BrainNote; kept?: boolean; error?: string } = {};
    try {
      const res = await fetch("/api/brain/voice-note", { method: "POST", body: form });
      ok = res.ok;
      data = await res.json().catch(() => ({}));
    } catch {
      ok = false;
    }
    setVoiceSaving(false);
    const note = data.note;
    if (!ok || !note) {
      const errors = m.brain.dump.errors as Record<string, string>;
      return void toast((data.error && errors[data.error]) || m.brain.errors.failed, "error");
    }
    setNotes((prev) => [note, ...prev]);
    setView({ kind: "note", id: note.id });
    toast(data.kept ? fill(m.voiceNote.savedIn, { region: m.brain.cat[note.category].label }) : m.voiceNote.notKept);
    void weaveAround([note.id]).then((report) => report && announce(report.created, note.id));
  }

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
            trace={trace}
            positions={positions}
          />
        </div>

        {/* On a phone, under the title rather than over it. */}
        <div className="absolute right-3 top-[4.5rem] z-10 flex items-center gap-2 sm:right-4 sm:top-4">
          {notes.length > 1 && !replay && (
            <button
              type="button"
              onClick={startReplay}
              title={m.brain.replay.startHint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/80 px-2 py-1 text-[0.7rem] text-muted-foreground backdrop-blur transition-colors hover:text-foreground [@media(pointer:coarse)]:py-2"
            >
              <History className="h-3.5 w-3.5" /> {m.brain.replay.start}
            </button>
          )}
          {map.constellations.length > 0 && (
            <div
              role="group"
              aria-label={m.brain.mindmap.colorBy}
              className="flex items-center rounded-lg border border-border bg-surface/80 p-0.5 text-[0.7rem] backdrop-blur"
            >
              {(["region", "constellation"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={colorBy === mode}
                  onClick={() => setColorBy(mode)}
                  className={cn(
                    "rounded-md px-2 py-1 transition-colors [@media(pointer:coarse)]:py-1.5",
                    colorBy === mode ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "region" ? m.brain.mindmap.byRegion : m.brain.mindmap.byConstellation}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* One column, top left: nothing on the stage can overlap it. */}
        <div className="pointer-events-none absolute left-5 top-5 max-w-[70%]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4 text-accent" /> {m.nav.brain}
          </div>
          <p className="mt-1 font-mono text-[0.72rem] text-muted-foreground" aria-live={visible ? "off" : undefined}>
            {visible?.at && `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(visible.at))} · `}
            {plural(locale, visible ? visible.notes.size : notes.length, m.brain.hudNotes)} ·{" "}
            {plural(locale, visible ? visible.links.size : links.length, m.brain.hudLinks)}
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

        {replay && (
          <div className="absolute inset-x-4 bottom-4 z-10">
            <div className="mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-border bg-surface/85 px-3 py-2 backdrop-blur">
              <button
                type="button"
                onClick={() =>
                  setReplay((r) =>
                    !r ? r : r.count >= events.length ? { count: 0, playing: true } : { ...r, playing: !r.playing }
                  )
                }
                aria-label={replay.playing ? m.brain.replay.pause : m.brain.replay.play}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-foreground text-background"
              >
                {replay.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={events.length}
                value={Math.min(replay.count, events.length)}
                onChange={(e) => setReplay({ count: Number(e.target.value), playing: false })}
                aria-label={m.brain.replay.position}
                className="min-w-0 flex-1 accent-[#22d3ee]"
              />
              <button
                type="button"
                onClick={() => setReplay(null)}
                aria-label={m.brain.replay.close}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Capture */}
        {talk && (
          <div className="absolute inset-x-4 bottom-4 z-10" role="status" aria-live="polite">
            <div className="mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-accent/30 bg-surface/90 px-3 py-2 backdrop-blur">
              <TalkOrb
                phase={talk.phase === "thinking" && speech.speaking ? "speaking" : talk.phase}
                level={talkRecorder.level}
                heard={talkRecorder.heard === "speaking"}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[0.8rem] font-medium">
                  {talk.phase === "listening"
                    ? m.brain.talk.listening
                    : talk.phase === "transcribing"
                      ? m.brain.talk.transcribing
                      : speech.speaking
                        ? m.brain.talk.speaking
                        : m.brain.talk.thinking}
                </p>
                <p className="truncate text-[0.68rem] text-muted-foreground">
                  {talk.heard ? `« ${talk.heard} »` : speechSupported() ? m.brain.talk.disclosure : m.brain.talk.noVoice}
                </p>
              </div>
              {talk.phase === "thinking" && speech.speaking && (
                <button
                  type="button"
                  onClick={interruptTalk}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-[0.72rem] hover:border-border-strong"
                >
                  {m.brain.talk.interrupt}
                </button>
              )}
              <button
                type="button"
                onClick={endTalk}
                aria-label={m.brain.talk.end}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {(noteRecorder.recording || voiceSaving) && (
          <div className="absolute inset-x-4 bottom-4 z-10" role="status" aria-live="polite">
            <div className="mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-danger/30 bg-surface/90 px-3 py-2 backdrop-blur">
              {voiceSaving ? (
                <p className="flex flex-1 items-center gap-2 text-[0.8rem] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" /> {m.voiceNote.saving}
                </p>
              ) : (
                <>
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" />
                  <span className="shrink-0 font-mono text-[0.78rem] tabular-nums">
                    {clock(noteRecorder.elapsed)} <span className="text-muted">/ {clock(MAX_RECORDING_MS)}</span>
                  </span>
                  <Meter level={noteRecorder.level} />
                  <span className="hidden min-w-0 flex-1 truncate text-[0.66rem] text-muted sm:block">{m.voiceNote.disclosure}</span>
                  <button
                    type="button"
                    onClick={noteRecorder.cancel}
                    className="shrink-0 rounded-md px-2 py-1 text-[0.74rem] text-muted-foreground hover:text-foreground"
                  >
                    {m.voiceNote.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={noteRecorder.stop}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[0.74rem] font-medium text-background"
                  >
                    <Square className="h-3 w-3" /> {m.voiceNote.stop}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {!replay && !talk && !noteRecorder.recording && !voiceSaving && (
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
                onPaste={(e) => {
                  // A single-line field would flatten a pasted page into one
                  // unreadable note. It goes to the dump instead, lines intact.
                  const pasted = e.clipboardData.getData("text");
                  if (!isDump(pasted)) return;
                  e.preventDefault();
                  openDump(draft.trim() ? `${draft.trim()}\n${pasted}` : pasted);
                  setDraft("");
                }}
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
              <button
                type="button"
                onClick={() => {
                  openDump(draft);
                  setDraft("");
                }}
                aria-label={m.brain.dump.open}
                title={`${m.brain.dump.open} — ${m.brain.dump.openHint}`}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                <AudioLines className="h-4 w-4" />
              </button>
              {voiceNotes ? (
                <button
                  type="button"
                  onClick={() => void noteRecorder.start()}
                  aria-label={m.voiceNote.record}
                  title={`${m.voiceNote.record} — ${m.voiceNote.disclosure}`}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Mic className="h-4 w-4" />
                </button>
              ) : dictation.supported && (
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
        )}
      </div>

      {/* Side panel */}
      <aside ref={panelRef} className="flex min-h-0 flex-col scroll-mt-4 border-t border-border xl:max-h-[74vh] xl:border-l xl:border-t-0">
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-2.5 focus-within:border-border-strong">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter asks: typing searches as you go, pressing Enter turns
                // what you typed into a question to the brain.
                if (e.key === "Enter" && !e.nativeEvent.isComposing && query.trim()) {
                  e.preventDefault();
                  ask(query);
                }
              }}
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
            {voiceEnabled && talkRecorder.supported && (
              <button
                type="button"
                onClick={talk ? endTalk : startTalk}
                aria-pressed={!!talk}
                aria-label={talk ? m.brain.talk.end : m.brain.talk.start}
                title={`${talk ? m.brain.talk.end : m.brain.talk.start} — ${m.brain.talk.disclosure}`}
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-md transition-colors",
                  talk ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Mic className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <AnimatePresence mode="wait">
            {query.trim() ? (
              <SearchResults key="search" query={query} results={results} onOpen={open} onAsk={ask} />
            ) : view.kind === "ask" ? (
              <BrainAnswer
                key={`ask-${view.seq}`}
                question={view.question}
                notes={notes}
                speak={view.voice}
                onSpoken={view.voice ? answerSpoken : undefined}
                history={turns.slice(-4).flatMap((t) => [
                  { role: "user" as const, content: t.q },
                  { role: "assistant" as const, content: t.a },
                ])}
                onAnswered={(a) => {
                  lastAnswer.current = { q: view.question, a };
                }}
                turns={turns}
                onNewThread={() => {
                  setTurns([]);
                  lastAnswer.current = null;
                  setView({ kind: "overview" });
                  searchRef.current?.focus();
                }}
                onTrace={(data) => setTrace(data ? { data, run: Date.now() } : null)}
                onOpen={open}
                onBack={() => setView({ kind: "overview" })}
                onReplay={() => setTrace((t) => (t ? { ...t, run: t.run + 1 } : t))}
                onAgain={() => {
                  setView({ kind: "overview" });
                  searchRef.current?.focus();
                }}
              />
            ) : view.kind === "decide" && decisionView ? (
              <TensionDecision
                key={`decide-${view.linkId}`}
                link={decisionView.link}
                a={decisionView.a}
                b={decisionView.b}
                aiEnabled={aiEnabled}
                memory={memory}
                onBack={() => setView({ kind: "overview" })}
                onOpen={open}
                onDecided={decided}
              />
            ) : view.kind === "dump" ? (
              <BrainDump
                // A new text (a share handed over) starts a new dump.
                key={`dump-${hash(view.text)}`}
                initialText={view.text}
                voiceEnabled={voiceEnabled}
                onBack={() => setView({ kind: "overview" })}
                onSaved={dumpSaved}
              />
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
                onDecide={decide}
              />
            ) : openConstellation ? (
              <ConstellationList
                key={`constellation-${openConstellation.id}`}
                constellation={openConstellation}
                map={map}
                notes={notes}
                onOpen={open}
                onBack={back}
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
                mindmap={map}
                now={now}
                weave={weaveState}
                weaveBlocked={weaveBlocked}
                onOpen={open}
                onRegion={toggleRegion}
                onTheme={openThemeView}
                onConstellation={openConstellationView}
                onReview={review}
                onWeave={organise}
                onDecide={decide}
                double={double}
                review={
                  memory ? (
                    <ReviewCard
                      queue={queue}
                      byId={byId}
                      today={today}
                      answered={answered}
                      memory={memory}
                      onAnswer={answerReview}
                      onOpen={open}
                    />
                  ) : undefined
                }
              />
            )}
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}

/** The state of a conversation, as a shape: it swells with the voice, spins while thinking, beats while answering. */
function TalkOrb({ phase, level, heard }: { phase: "listening" | "transcribing" | "thinking" | "speaking"; level: number; heard: boolean }) {
  if (phase === "transcribing" || phase === "thinking") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    );
  }
  const scale = phase === "listening" ? 1 + Math.min(0.45, level * 0.9) : 1;
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center">
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full transition-transform duration-75",
          phase === "speaking" ? "animate-pulse bg-accent/30" : heard ? "bg-accent/35" : "bg-accent/15"
        )}
        style={{ transform: `scale(${scale})` }}
      />
      <Mic className="relative h-4 w-4 text-accent" />
    </span>
  );
}
