"use client";

import { useMemo, useState } from "react";
import { BookmarkPlus, HandHelping, Heart, Loader2, PenLine, Search, Share2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { CATEGORY_IDS, type BrainCategoryId } from "@/lib/data/brain";
import { PULSE_MIN_RESPONSES } from "@/lib/team/rules";
import type { TeamNoteView, TeamPageView } from "@/lib/team/view";
import {
  giveKudos,
  keepTeamNote,
  postTeamNote,
  removeKudos,
  removeTeamNote,
  saveCheckin,
  savePulse,
  setHelp,
  shareNote,
} from "@/app/actions/team";
import { useTeamAction } from "./use-team-action";
import { PinButton } from "./first-hire";

const input = "w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent/60";

function useAgo() {
  const locale = useLocale();
  return (iso: string) => {
    const rtf = new Intl.RelativeTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { numeric: "auto" });
    const s = (Date.parse(iso) - Date.now()) / 1000;
    // Intl's "this minute" reads oddly in a feed.
    if (Math.abs(s) < 60) return locale === "fr" ? "à l'instant" : "just now";
    if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), "minute");
    if (Math.abs(s) < 86_400) return rtf.format(Math.round(s / 3600), "hour");
    return rtf.format(Math.round(s / 86_400), "day");
  };
}

function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.72rem] font-medium", className)} aria-hidden>
      {initials || "•"}
    </span>
  );
}

/* ── Activity ─────────────────────────────────────────────────────── */

type Event =
  | { kind: "shared"; at: string; who: string; title: string }
  | { kind: "posted"; at: string; who: string; help: boolean }
  | { kind: "kudos"; at: string; id: string; from: string; to: string; message: string; mine: boolean };

export function TeamFeed({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const ago = useAgo();
  const { run, pending } = useTeamAction();
  const others = view.members.filter((x) => !x.me);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [message, setMessage] = useState("");

  const events = useMemo<Event[]>(() => {
    const all: Event[] = [
      ...view.notes.map((n): Event => ({ kind: "shared", at: n.createdAt, who: n.authorName, title: n.title })),
      ...view.checkins.map((c): Event => ({ kind: "posted", at: c.updatedAt, who: c.authorName, help: c.helpWanted })),
      ...view.kudos.map((k): Event => ({ kind: "kudos", at: k.createdAt, id: k.id, from: k.fromName, to: k.toName, message: k.message, mine: k.mine })),
    ];
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  }, [view]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to || !message.trim()) return;
    const ok = await run(() => giveKudos(view.team.id, to, message), t.kudos.sent);
    if (ok !== null) setMessage("");
  };

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        {events.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">{t.feed.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((ev, i) => (
              <li key={i} className="flex gap-3 px-5 py-3.5">
                <Avatar name={ev.kind === "kudos" ? ev.from : ev.who} />
                <div className="min-w-0 flex-1 text-sm">
                  {ev.kind === "shared" && (
                    <p>
                      <span className="font-medium">{ev.who}</span> {t.feed.shared} · <span className="text-muted-foreground">{ev.title}</span>
                    </p>
                  )}
                  {ev.kind === "posted" && (
                    <p>
                      <span className="font-medium">{ev.who}</span> {t.feed.posted}
                      {ev.help && <span className="ml-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[0.72rem] text-warning">{t.feed.needsHelp}</span>}
                    </p>
                  )}
                  {ev.kind === "kudos" && (
                    <>
                      <p>
                        <span className="font-medium">{ev.from}</span> {t.feed.thanked} <span className="font-medium">{ev.to}</span>
                        <Heart className="ml-1.5 inline h-3.5 w-3.5 text-danger" aria-hidden />
                      </p>
                      <p className="mt-0.5 text-muted-foreground">« {ev.message} »</p>
                    </>
                  )}
                  <p className="mt-0.5 text-[0.75rem] text-muted">{ago(ev.at)}</p>
                </div>
                {ev.kind === "kudos" && (ev.mine || view.me.role !== "member") && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void run(() => removeKudos(view.team.id, ev.id))}
                    aria-label={t.brain.remove}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="self-start">
        <CardHeader title={<span className="flex items-center gap-2"><Heart className="h-4 w-4 text-danger" aria-hidden />{t.kudos.title}</span>} />
        {others.length === 0 ? (
          <p className="px-5 py-5 text-sm text-muted-foreground">{t.kudos.nobody}</p>
        ) : (
          <form onSubmit={send} className="space-y-3 px-5 py-4">
            <label className="block text-[0.8125rem] text-muted-foreground">
              {t.kudos.to}
              <select value={to} onChange={(e) => setTo(e.target.value)} className={cn(input, "mt-1 h-10")}>
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder={t.kudos.placeholder}
              className={cn(input, "resize-none py-2")}
            />
            <button
              type="submit"
              disabled={pending || !message.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
            >
              {t.kudos.send}
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}

/* ── The collective brain ─────────────────────────────────────────── */

function NoteCard({ note, view, compact = false }: { note: TeamNoteView; view: TeamPageView; compact?: boolean }) {
  const m = useMessages();
  const t = m.team;
  const ago = useAgo();
  const { run, pending } = useTeamAction();
  const canRemove = note.mine || view.me.role !== "member";
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-3.5">
      <div className="flex items-start gap-2.5">
        <Avatar name={note.authorName} className="h-7 w-7 text-[0.65rem]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{note.title}</p>
          {!compact && note.detail && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[0.8125rem] text-muted-foreground">{note.detail}</p>}
          <p className="mt-1 text-[0.72rem] text-muted">
            {note.authorName} · {m.brain.cat[note.category].label} · {ago(note.createdAt)}
          </p>
        </div>
      </div>
      {!compact && (
        <div className="mt-2.5 flex gap-1.5">
          {!note.mine && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void run(() => keepTeamNote(view.team.id, note.id), t.brain.kept)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[0.75rem] text-muted-foreground hover:text-foreground"
            >
              <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
              {t.brain.keep}
            </button>
          )}
          <PinButton note={note} view={view} />
          {canRemove && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void run(() => removeTeamNote(view.team.id, note.id))}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] text-muted-foreground hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t.brain.remove}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Shared({ terms }: { terms: string[] }) {
  const m = useMessages();
  if (terms.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1 text-[0.75rem] text-muted-foreground">
      {m.team.brain.inCommon}
      {terms.map((x) => (
        <span key={x} className="rounded-md bg-accent/15 px-1.5 py-0.5 text-accent">
          {x}
        </span>
      ))}
    </p>
  );
}

export function TeamBrain({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const { run, pending } = useTeamAction();
  const [query, setQuery] = useState("");
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState<BrainCategoryId>("knowledge");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? view.shareable.filter((n) => n.title.toLowerCase().includes(q)) : view.shareable;
    return list.slice(0, 6);
  }, [query, view.shareable]);

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => postTeamNote(view.team.id, { title, detail: detail || null, category }));
    if (ok !== null) {
      setTitle("");
      setDetail("");
      setWriting(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {/* Encounters: the team's own synapses. */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" aria-hidden />{t.brain.encounters}</span>} />
          <div className="px-5 py-4">
            <p className="text-[0.8125rem] text-muted-foreground">{t.brain.encountersHelp}</p>
            {view.encounters.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t.brain.encountersEmpty}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {view.encounters.map((e) => (
                  <li key={`${e.a.id}${e.b.id}`} className="rounded-xl border border-accent/25 bg-accent/5 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <NoteCard note={e.a} view={view} compact />
                      <NoteCard note={e.b} view={view} compact />
                    </div>
                    <Shared terms={e.shared} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t.brain.all} />
          {view.notes.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">{t.brain.empty}</p>
          ) : (
            <div className="grid gap-2.5 p-4 sm:grid-cols-2">
              {view.notes.map((n) => (
                <NoteCard key={n.id} note={n} view={view} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-3">
        {/* Share from one's own brain: the only door from private to shared. */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Share2 className="h-4 w-4 text-accent" aria-hidden />{t.brain.share}</span>} />
          <div className="px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.brain.pick} className={cn(input, "h-9 pl-9")} />
            </div>
            {matches.length === 0 ? (
              <p className="mt-3 text-[0.8125rem] text-muted-foreground">{t.brain.shareNothing}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {matches.map((n) => (
                  <li key={n.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{n.title}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void run(() => shareNote(view.team.id, n.id), t.brain.shared)}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[0.75rem] text-muted-foreground hover:border-accent/60 hover:text-foreground"
                    >
                      <Share2 className="h-3.5 w-3.5" aria-label={t.brain.share} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setWriting((w) => !w)}
              className="mt-3 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground"
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden />
              {t.brain.post}
            </button>
            {writing && (
              <form onSubmit={post} className="mt-2 space-y-2">
                <input required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.brain.postTitle} className={cn(input, "h-9")} />
                <textarea maxLength={4000} rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t.brain.postDetail} className={cn(input, "resize-none py-2")} />
                <select value={category} onChange={(e) => setCategory(e.target.value as BrainCategoryId)} aria-label={t.brain.region} className={cn(input, "h-9")}>
                  {CATEGORY_IDS.map((c) => (
                    <option key={c} value={c}>
                      {m.brain.cat[c].label}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={pending || !title.trim()} className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50">
                  {t.brain.postSubmit}
                </button>
              </form>
            )}
          </div>
        </Card>

        {/* For you: private to the viewer. */}
        <Card>
          <CardHeader title={t.brain.forYou} />
          <div className="px-4 py-3">
            <p className="text-[0.8125rem] text-muted-foreground">{t.brain.forYouHelp}</p>
            {view.forYou.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t.brain.forYouEmpty}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {view.forYou.map((f) => (
                  <li key={f.theirs.id}>
                    <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted">{t.brain.yourNote}</p>
                    <p className="text-sm">{f.mine.title}</p>
                    <div className="mt-1.5">
                      <NoteCard note={f.theirs} view={view} compact />
                    </div>
                    <Shared terms={f.shared} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ── The weekly check-in ──────────────────────────────────────────── */

export function TeamCheckin({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const ago = useAgo();
  const { run, pending } = useTeamAction();
  const [done, setDone] = useState(view.mine?.done ?? "");
  const [focus, setFocus] = useState(view.mine?.focus ?? "");
  const [blocker, setBlocker] = useState(view.mine?.blocker ?? "");
  const [help, setHelpWanted] = useState(view.mine?.helpWanted ?? false);
  const week = view.week.split("-W")[1];

  const draft = () => {
    // Fills only what is empty: never overwrites what the person wrote.
    if (!focus) setFocus(view.draft.focus);
    if (!blocker) setBlocker(view.draft.blocker);
  };

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!done.trim() && !focus.trim() && !blocker.trim()) return;
    await run(() => saveCheckin(view.team.id, { done, focus, blocker, helpWanted: help }), t.checkin.saved);
  };

  const fields: [string, string, (v: string) => void, string][] = [
    [t.checkin.done, done, setDone, t.checkin.donePlaceholder],
    [t.checkin.focus, focus, setFocus, t.checkin.focusPlaceholder],
    [t.checkin.blocker, blocker, setBlocker, t.checkin.blockerPlaceholder],
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Card className="self-start lg:col-span-2">
        <CardHeader
          title={fill(t.checkin.title, { week })}
          action={
            <button type="button" onClick={draft} className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground hover:text-foreground">
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              {t.checkin.draft}
            </button>
          }
        />
        <form onSubmit={post} className="space-y-3 px-5 py-4">
          {fields.map(([label, value, set, placeholder]) => (
            <label key={label} className="block text-[0.8125rem] text-muted-foreground">
              {label}
              <textarea value={value} onChange={(e) => set(e.target.value)} maxLength={1000} rows={3} placeholder={placeholder} className={cn(input, "mt-1 resize-y py-2")} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={help} disabled={!blocker.trim()} onChange={(e) => setHelpWanted(e.target.checked)} className="accent-[hsl(var(--accent))]" />
            {t.checkin.helpWanted}
          </label>
          <button
            type="submit"
            disabled={pending || (!done.trim() && !focus.trim() && !blocker.trim())}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {view.mine ? t.checkin.update : t.checkin.post}
          </button>
        </form>
      </Card>

      <div className="space-y-3 lg:col-span-3">
        <h2 className="text-sm font-medium">{t.checkin.team}</h2>
        {view.checkins.length === 0 && <p className="text-sm text-muted-foreground">{t.checkin.empty}</p>}
        {view.checkins.map((c) => (
          <Card key={c.id} className={cn("p-4", c.helpWanted && "border-warning/40")}>
            <div className="flex items-center gap-2.5">
              <Avatar name={c.authorName} />
              <p className="flex-1 text-sm font-medium">
                {c.authorName}
                {c.helpWanted && <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[0.72rem] font-normal text-warning">{t.feed.needsHelp}</span>}
              </p>
              <span className="text-[0.75rem] text-muted">{ago(c.updatedAt)}</span>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              {(
                [
                  [t.checkin.done, c.done],
                  [t.checkin.focus, c.focus],
                  [t.checkin.blocker, c.blocker],
                ] as const
              ).map(([label, value]) =>
                value ? (
                  <div key={label}>
                    <dt className="text-[0.72rem] uppercase tracking-[0.08em] text-muted">{label}</dt>
                    <dd className="mt-0.5 whitespace-pre-line">{value}</dd>
                  </div>
                ) : null
              )}
            </dl>
            {(c.helpWanted || c.helpers.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[0.8125rem]">
                {c.helpers.length > 0 && <span className="text-muted-foreground">{fill(t.checkin.helpers, { names: c.helpers.join(", ") })}</span>}
                {!c.mine && c.helpWanted && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void run(() => setHelp(view.team.id, c.id, !c.iHelp))}
                    className={cn(
                      "ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors",
                      c.iHelp ? "bg-success/15 text-success" : "border border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <HandHelping className="h-3.5 w-3.5" aria-hidden />
                    {c.iHelp ? t.checkin.helping : t.checkin.canHelp}
                  </button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ── The pulse ────────────────────────────────────────────────────── */

function Scale({ label, value, onChange, low, high }: { label: string; value: number; onChange: (v: number) => void; low: string; high: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "h-10 flex-1 rounded-lg border text-sm tabular-nums transition-colors",
              value === v ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.72rem] text-muted">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

/** A 1–5 average as a meter: the filled part in the accent, the track a lighter step of it. */
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}/5</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-accent/15" role="meter" aria-valuemin={1} aria-valuemax={5} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
    </div>
  );
}

export function TeamPulse({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const { run, pending } = useTeamAction();
  const [energy, setEnergy] = useState(view.pulse.mine?.energy ?? 3);
  const [load, setLoad] = useState(view.pulse.mine?.load ?? 3);
  const team = view.pulse.team;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-medium">{t.pulse.title}</h2>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">{fill(t.pulse.help, { k: PULSE_MIN_RESPONSES })}</p>
        <div className="mt-4 space-y-4">
          <Scale label={t.pulse.energy} value={energy} onChange={setEnergy} low={t.pulse.low} high={t.pulse.high} />
          <Scale label={t.pulse.load} value={load} onChange={setLoad} low={t.pulse.low} high={t.pulse.high} />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => void run(() => savePulse(view.team.id, energy, load), t.pulse.saved)}
          className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {t.pulse.save}
        </button>
        {view.pulse.mine && (
          <p className="mt-3 text-[0.75rem] text-muted">
            {t.pulse.yours} · {fill(t.pulse.averages, { energy: view.pulse.mine.energy, load: view.pulse.mine.load })}
          </p>
        )}
      </Card>
      <Card className="self-start p-5">
        <h2 className="font-medium">{t.pulse.team}</h2>
        {team.energy === null || team.load === null ? (
          <p className="mt-3 text-sm text-muted-foreground">{fill(t.pulse.below, { k: PULSE_MIN_RESPONSES, n: team.responses })}</p>
        ) : (
          <div className="mt-4 space-y-4">
            <Meter label={t.pulse.energy} value={team.energy} />
            <Meter label={t.pulse.load} value={team.load} />
          </div>
        )}
      </Card>
    </div>
  );
}
