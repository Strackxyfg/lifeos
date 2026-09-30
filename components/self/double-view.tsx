"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, UserRound } from "lucide-react";
import { adviceState, addTrait, correctTrait, judgeTrait, readForPortrait, removeTrait, type Accepted, type CheckinSaved } from "@/app/actions/self";
import { updateNote } from "@/app/actions/brain";
import { adoptNextSteps, proposeNextSteps, weaveNotes } from "@/app/actions/weave";
import { createReminder } from "@/app/actions/reminders";
import { pairKey, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { adviseFor, type Advice, type AdviceAction, type AdviceState } from "@/lib/self/advice";
import { coverage, portraitOf, type Dimension, type TraitLike } from "@/lib/self/portrait";
import { followUps, questionsFor } from "@/lib/self/questions";
import { localDayHour, summarize } from "@/lib/self/rhythm";
import type { SelfData } from "@/lib/self/store";
import { toast } from "@/components/ui/toaster";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { BrainTabs } from "./brain-tabs";
import { TodayCard } from "./today-card";
import { AdviceList, formatWhen, type AdviceHandlers } from "./advice-list";
import { PortraitPanel } from "./portrait-panel";
import { RhythmPanel } from "./rhythm-panel";
import { DoubleChat } from "./double-chat";
import type { TraitHandlers } from "./trait-row";

type Checkin = SelfData["checkins"][number];
type Reminder = { noteId: string | null; done: boolean; dueAt: string };

/** Adds connections not already present (by pair). */
function mergeLinks(prev: BrainLink[], incoming: BrainLink[]): BrainLink[] {
  const have = new Set(prev.map((l) => pairKey(l.fromId, l.toId)));
  const fresh = incoming.filter((l) => !have.has(pairKey(l.fromId, l.toId)));
  return fresh.length ? [...prev, ...fresh] : prev;
}

/** Replaces traits by id, adds the new ones. */
function upsertTraits(prev: TraitLike[], incoming: TraitLike[]): TraitLike[] {
  const byId = new Map(incoming.map((t) => [t.id, t]));
  const kept = prev.map((t) => byId.get(t.id) ?? t);
  const known = new Set(prev.map((t) => t.id));
  return [...kept, ...incoming.filter((t) => !known.has(t.id))];
}

/**
 * The time zone and the time, known only in the browser: until they are,
 * time-bound parts wait (no guess rendered on the server, then corrected).
 * The clock moves every minute, so the day turns at midnight without a reload.
 */
function useClock(): { zone: string; now: Date } | null {
  const [clock, setClock] = useState<{ zone: string; now: Date } | null>(null);
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setClock({ zone, now: new Date() });
    const timer = window.setInterval(() => setClock({ zone, now: new Date() }), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return clock;
}

export function DoubleView({
  available,
  aiEnabled,
  initialNotes,
  initialLinks,
  initialTraits,
  initialCheckins,
  initialAdvice,
  initialReminders,
  name,
  seed,
}: {
  /** Migration 015 applied. */
  available: boolean;
  aiEnabled: boolean;
  initialNotes: BrainNote[];
  initialLinks: BrainLink[];
  initialTraits: TraitLike[];
  initialCheckins: Checkin[];
  initialAdvice: AdviceState[];
  initialReminders: Reminder[];
  name: string | null;
  /** Per person: which questions come on which day. */
  seed: string;
}) {
  const m = useMessages();
  const locale = useLocale();
  const s = m.self;
  const clock = useClock();
  const zone = clock?.zone ?? null;

  const [notes, setNotes] = useState(initialNotes);
  const [links, setLinks] = useState(initialLinks);
  const [traits, setTraits] = useState(initialTraits);
  const [checkins, setCheckins] = useState(initialCheckins);
  const [states, setStates] = useState(initialAdvice);
  const [reminders, setReminders] = useState(initialReminders);
  const [reading, setReading] = useState(false);

  const err = useCallback((code: keyof typeof s.errors | undefined) => toast(s.errors[code ?? "failed"], "error"), [s]);

  /* ── Derived: everything from the data as it is now ── */
  const now = clock?.now ?? null;
  const local = useMemo(() => (clock ? localDayHour(clock.now, clock.zone) : null), [clock]);
  const day = local?.day ?? null;
  const summary = useMemo(() => (day ? summarize(checkins, day) : null), [checkins, day]);
  const answered = useMemo(() => new Set(checkins.map((c) => c.questionId).filter((q): q is string => !!q)), [checkins]);
  const questions = useMemo(() => {
    if (!day || !now) return [];
    const follow = followUps({ notes, links, now, answered });
    return questionsFor({ day, seed, coverage: coverage(traits), answered, followUps: follow });
  }, [day, now, seed, traits, answered, notes, links]);
  const advice = useMemo(
    () =>
      zone && now && summary
        ? adviseFor({ notes, links, reminders, rhythm: summary, traits, states, now, zone, locale: locale === "fr" ? "fr" : "en" })
        : [],
    [notes, links, reminders, summary, traits, states, now, zone, locale]
  );
  const portrait = useMemo(() => portraitOf(traits, notes), [traits, notes]);
  const titles = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes]);
  const traitsById = useMemo(() => new Map(traits.map((t) => [t.id, t])), [traits]);
  const todayCheckins = useMemo(() => (day ? checkins.filter((c) => c.day === day) : []), [checkins, day]);

  /* ── The portrait ── */
  const handlers: TraitHandlers = {
    onJudge: async (id, verdict) => {
      const before = traits;
      setTraits((prev) => prev.map((t) => (t.id === id ? { ...t, status: verdict } : t)));
      const res = await judgeTrait(id, verdict).catch(() => null);
      if (!res || !res.ok) {
        setTraits(before);
        return err(res?.code);
      }
      toast(verdict === "rejected" ? s.portrait.rejected : s.portrait.confirmedToast);
    },
    onCorrect: async (id, statement) => {
      const res = await correctTrait(id, statement).catch(() => null);
      if (!res || !res.ok) {
        err(res?.code);
        return false;
      }
      setTraits((prev) => upsertTraits(prev, [res.data]));
      return true;
    },
    onRemove: async (id) => {
      const res = await removeTrait(id).catch(() => null);
      if (!res || !res.ok) return err(res?.code);
      setTraits((prev) => (res.data.rejected ? prev.map((t) => (t.id === id ? { ...t, status: "rejected" } : t)) : prev.filter((t) => t.id !== id)));
      if (res.data.rejected) toast(s.portrait.rejected);
    },
  };

  const addOwn = async (dimension: Dimension, statement: string) => {
    const res = await addTrait({ dimension, statement }).catch(() => null);
    if (!res || !res.ok) {
      err(res?.code);
      return false;
    }
    setTraits((prev) => upsertTraits(prev, [res.data]));
    toast(s.portrait.confirmedToast);
    return true;
  };

  /** The double reads notes for the portrait: the given ones, or the ones that say most. */
  const read = async (noteIds?: string[]): Promise<TraitLike[] | null> => {
    const res = await readForPortrait({ noteIds, locale }).catch(() => null);
    if (!res || !res.ok) {
      err(res?.code);
      return null;
    }
    setTraits((prev) => upsertTraits(prev, [...res.data.added, ...res.data.updated]));
    return res.data.added;
  };

  const readAll = async () => {
    setReading(true);
    const res = await readForPortrait({ locale }).catch(() => null);
    setReading(false);
    if (!res || !res.ok) return err(res?.code);
    setTraits((prev) => upsertTraits(prev, [...res.data.added, ...res.data.updated]));
    const parts = [
      res.data.added.length ? plural(locale, res.data.added.length, s.portrait.found) : null,
      res.data.updated.length ? plural(locale, res.data.updated.length, s.portrait.supported) : null,
    ].filter(Boolean);
    toast(parts.length ? parts.join(" · ") : s.portrait.nothingNew);
  };

  /* ── Check-ins ── */
  const saved = (x: CheckinSaved) => {
    setCheckins((prev) => [...prev, x.checkin]);
    if (x.note) setNotes((prev) => [x.note!, ...prev]);
    if (x.links.length) setLinks((prev) => mergeLinks(prev, x.links));
  };

  /* ── Advice ── */
  const settle = async (a: Advice, status: "dismissed" | "snoozed" | "done") => {
    const until = status === "snoozed" ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null;
    setStates((prev) => [...prev.filter((x) => x.adviceKey !== a.key), { adviceKey: a.key, status, until }]);
    const res = await adviceState(a.key, status).catch(() => null);
    if (!res || !res.ok) {
      setStates((prev) => prev.filter((x) => x.adviceKey !== a.key));
      err(res?.code);
      return false;
    }
    return true;
  };

  const adviceHandlers: AdviceHandlers = {
    run: async (a: Advice, action: AdviceAction) => {
      if (action.type === "done") {
        const res = await updateNote(action.noteId, { done: true }).catch(() => null);
        if (!res || !res.ok) return err("failed");
        setNotes((prev) => prev.map((n) => (n.id === action.noteId ? { ...n, done: true } : n)));
        await settle(a, "done");
        toast(s.advice.markedDone);
      } else if (action.type === "remind") {
        if (!zone) return;
        const res = await createReminder({ title: action.title, dueAt: action.at, repeat: "none", zone, noteId: action.noteId }).catch(() => null);
        if (!res || !res.ok) return err(res?.code === "migration_pending" ? "migration_pending" : "failed");
        setReminders((prev) => [...prev, { noteId: action.noteId, done: false, dueAt: action.at }]);
        await settle(a, "done");
        toast(fill(s.advice.reminded, { when: formatWhen(action.at, locale, zone) }));
      } else if (action.type === "weave") {
        const res = await weaveNotes([action.noteId]).catch(() => null);
        if (!res || !res.ok) return err(res?.code === "rate_limit" ? "rate_limit" : "failed");
        if (res.data.created.length === 0) return void toast(s.advice.noLinks);
        setLinks((prev) => mergeLinks(prev, res.data.created));
        toast(plural(locale, res.data.created.length, m.brain.weave.created));
      }
    },
    proposeSteps: async (noteId) => {
      const res = await proposeNextSteps(noteId).catch(() => null);
      if (!res || !res.ok) {
        err(res?.code === "rate_limit" ? "rate_limit" : res?.code === "unavailable" ? "unavailable" : "failed");
        return null;
      }
      if (res.data.length === 0) toast(m.brain.develop.empty);
      return res.data;
    },
    adoptSteps: async (_a, noteId, steps) => {
      const res = await adoptNextSteps({ id: noteId, steps }).catch(() => null);
      if (!res || !res.ok) {
        err("failed");
        return false;
      }
      setNotes((prev) => [...res.data.notes, ...prev]);
      setLinks((prev) => mergeLinks(prev, res.data.links));
      toast(plural(locale, res.data.notes.length, m.brain.develop.added));
      return true;
    },
    setState: async (a, status) => {
      if (await settle(a, status)) toast(status === "dismissed" ? s.advice.dismissed : s.advice.snoozed);
    },
  };

  const accepted = (a: Accepted) => {
    if (a.note) setNotes((prev) => [a.note!, ...prev]);
    if (a.links.length) setLinks((prev) => mergeLinks(prev, a.links));
  };

  return (
    <>
      <BrainTabs active="double" badge={advice.length || undefined} />
      {!available && (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-surface-2/40 p-4 text-[0.84rem] leading-relaxed text-muted-foreground">
          <Database className="mt-0.5 h-4 w-4 shrink-0" /> {s.pending}
        </p>
      )}
      {available && !aiEnabled && <p className="mb-5 rounded-xl border border-border bg-surface-2/40 p-4 text-[0.82rem] text-muted-foreground">{s.noAi}</p>}

      {!zone || !local || !summary ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-surface">
          <UserRound className="h-7 w-7 animate-pulse text-accent" />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
          <div className="flex min-w-0 flex-col gap-5">
            {available && (
              <TodayCard
                name={name}
                zone={zone}
                hour={local.hour}
                todayCheckins={todayCheckins}
                streak={summary.streak}
                questions={questions}
                aiEnabled={aiEnabled}
                onSaved={saved}
                learn={(id) => read([id])}
                traits={traitsById}
                titles={titles}
                handlers={handlers}
              />
            )}
            <AdviceList advice={advice} handlers={adviceHandlers} zone={zone} />
            <DoubleChat aiEnabled={aiEnabled} zone={zone} onAccepted={accepted} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            {available && <PortraitPanel portrait={portrait} aiEnabled={aiEnabled} reading={reading} onRead={() => void readAll()} onAdd={addOwn} handlers={handlers} />}
            {available && <RhythmPanel summary={summary} today={local.day} />}
          </div>
        </div>
      )}
    </>
  );
}
