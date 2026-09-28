"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, BellRing, CalendarClock, Check, Clock3, Loader2, Plus, Repeat2, Trash2, Undo2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { parseReminder } from "@/lib/reminders/parse";
import { bucketOf, REPEATS, type Bucket, type Repeat, type SnoozeChoice } from "@/lib/reminders/schedule";
import { browserZone, formatWhen, toLocalInput } from "@/lib/reminders/format";
import { REMINDERS_EVENT, REMINDER_UPDATED_EVENT, type ClientReminder } from "@/lib/reminders/client";
import {
  completeReminder,
  createReminder,
  deleteReminder,
  reopenReminder,
  snoozeReminder,
  type ReminderErrorCode,
} from "@/app/actions/reminders";


const BUCKETS: Bucket[] = ["overdue", "today", "tomorrow", "week", "later"];
const SNOOZES: SnoozeChoice[] = ["10m", "1h", "tomorrow", "nextWeek"];

function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function RemindersPanel({
  initial,
  available,
  notes,
}: {
  initial: ClientReminder[];
  available: boolean;
  /** Titles of the notes reminders point at, by id. */
  notes: Record<string, string>;
}) {
  const m = useMessages();
  const r = m.reminders;
  const locale = useLocale();
  const now = useNow();
  const zone = useMemo(() => browserZone(), []);

  const [items, setItems] = useState<ClientReminder[]>(initial);
  const [text, setText] = useState("");
  const [manualAt, setManualAt] = useState<string>("");
  const [manualRepeat, setManualRepeat] = useState<Repeat | null>(null);
  const [saving, setSaving] = useState(false);
  const [showWhen, setShowWhen] = useState(false);
  // Just ticked off: kept on screen a few seconds with an undo.
  const [justDone, setJustDone] = useState<Record<string, number>>({});
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const say = (code: ReminderErrorCode) => toast(r.errors[code], "error");

  // Tell the watcher (and any other listener) the open list changed.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(REMINDERS_EVENT, { detail: items.filter((i) => !i.done) }));
  }, [items]);

  const parsed = useMemo(() => (text.trim() ? parseReminder(text, now, zone, locale) : null), [text, now, zone, locale]);
  const dueAt = manualAt ? new Date(manualAt) : (parsed?.dueAt ?? null);
  const repeat: Repeat = manualRepeat ?? parsed?.repeat ?? "none";
  const title = (parsed?.title || text).trim();

  const submit = async () => {
    if (busy.current || !title) return;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      setShowWhen(true);
      return;
    }
    busy.current = true;
    setSaving(true);
    const temp: ClientReminder = {
      id: `temp-${Date.now()}`,
      title,
      dueAt: dueAt.toISOString(),
      repeat,
      zone,
      done: false,
      doneAt: null,
      noteId: null,
      notifiedAt: null,
    };
    setItems((xs) => [...xs, temp]);
    const res = await createReminder({ title, dueAt: dueAt.toISOString(), repeat, zone });
    busy.current = false;
    setSaving(false);
    if (!res.ok) {
      setItems((xs) => xs.filter((x) => x.id !== temp.id));
      say(res.code);
      return;
    }
    setItems((xs) => xs.map((x) => (x.id === temp.id ? res.data : x)));
    setText("");
    setManualAt("");
    setManualRepeat(null);
    setShowWhen(false);
    toast(fill(r.savedToast, { when: formatWhen(new Date(res.data.dueAt), new Date(), locale, res.data.zone).toLowerCase() }));
    input.current?.focus();
  };

  const complete = async (it: ClientReminder) => {
    const before = items;
    if (it.repeat === "none") setJustDone((j) => ({ ...j, [it.id]: Date.now() }));
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, done: it.repeat === "none" } : x)));
    const res = await completeReminder(it.id);
    if (!res.ok) {
      setItems(before);
      say(res.code);
      return;
    }
    setItems((xs) => xs.map((x) => (x.id === it.id ? res.data : x)));
    if (it.repeat !== "none") {
      toast(fill(r.nextToast, { when: formatWhen(new Date(res.data.dueAt), new Date(), locale, res.data.zone).toLowerCase() }));
    }
  };

  const undo = async (it: ClientReminder) => {
    setJustDone((j) => {
      const { [it.id]: _, ...rest } = j;
      return rest;
    });
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, done: false } : x)));
    const res = await reopenReminder(it.id);
    if (!res.ok) {
      say(res.code);
      return;
    }
    setItems((xs) => xs.map((x) => (x.id === it.id ? res.data : x)));
  };

  const snooze = async (it: ClientReminder, choice: SnoozeChoice) => {
    const res = await snoozeReminder(it.id, choice);
    if (!res.ok) return say(res.code);
    setItems((xs) => xs.map((x) => (x.id === it.id ? res.data : x)));
  };

  const remove = async (it: ClientReminder) => {
    const before = items;
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    const res = await deleteReminder(it.id);
    if (!res.ok) {
      setItems(before);
      return say(res.code);
    }
    toast(r.removedToast);
  };

  // A done one-off leaves the list after its undo window.
  useEffect(() => {
    const ids = Object.keys(justDone);
    if (ids.length === 0) return;
    const t = setTimeout(() => {
      const cutoff = Date.now() - 5000;
      setJustDone((j) => Object.fromEntries(Object.entries(j).filter(([, at]) => at > cutoff)));
    }, 1000);
    return () => clearTimeout(t);
  }, [justDone]);

  // The watcher can complete or snooze from its alert: follow along.
  useEffect(() => {
    const onChange = (e: Event) => {
      const updated = (e as CustomEvent<ClientReminder>).detail;
      setItems((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
    };
    window.addEventListener(REMINDER_UPDATED_EVENT, onChange);
    return () => window.removeEventListener(REMINDER_UPDATED_EVENT, onChange);
  }, []);

  const visible = items.filter((i) => !i.done || justDone[i.id]);
  const grouped = BUCKETS.map((b) => ({
    bucket: b,
    items: visible
      .filter((i) => bucketOf(new Date(i.dueAt), now, i.zone) === b)
      .sort((a, c) => Date.parse(a.dueAt) - Date.parse(c.dueAt)),
  })).filter((g) => g.items.length > 0);

  if (!available) {
    return (
      <Card>
        <CardHeader title={r.title} />
        <p className="px-5 py-6 text-sm text-muted-foreground">{r.errors.migration_pending}</p>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-accent" aria-hidden />{r.title}</span>} action={<NotifyToggle />} />

      {/* Compose */}
      <form
        className="border-b border-border px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-2">
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={r.placeholder}
            aria-label={r.title}
            maxLength={300}
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent/60"
          />
          <button
            type="button"
            onClick={() => setShowWhen((s) => !s)}
            aria-label={r.when}
            aria-expanded={showWhen}
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground",
              showWhen && "border-accent/60 text-foreground"
            )}
          >
            <Clock3 className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!title || saving}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-foreground transition-opacity disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="hidden sm:inline">{r.add}</span>
          </button>
        </div>

        {/* What was understood — seen before it is saved, never discovered at the wrong hour. */}
        {text.trim() && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
            <span className="text-muted">{r.understood}</span>
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium">{title || "…"}</span>
            {dueAt && !Number.isNaN(dueAt.getTime()) ? (
              <span className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-accent">
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatWhen(dueAt, now, locale, zone)}
              </span>
            ) : (
              <span className="text-muted">{r.noMoment}</span>
            )}
            {repeat !== "none" && (
              <span className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-accent">
                <Repeat2 className="h-3 w-3" aria-hidden />
                {r.repeat[repeat]}
              </span>
            )}
          </div>
        )}

        <AnimatePresence initial={false}>
          {showWhen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease }}
              className="overflow-hidden"
            >
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-[0.75rem] text-muted-foreground">
                  {r.when}
                  <input
                    type="datetime-local"
                    value={manualAt || (parsed?.dueAt ? toLocalInput(parsed.dueAt) : "")}
                    onChange={(e) => setManualAt(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-2/60 px-2.5 text-sm text-foreground outline-none focus:border-accent/60"
                  />
                </label>
                <label className="text-[0.75rem] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Repeat2 className="h-3 w-3" aria-hidden />
                  </span>
                  <select
                    value={repeat}
                    onChange={(e) => setManualRepeat(e.target.value as Repeat)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-2/60 px-2 text-sm text-foreground outline-none focus:border-accent/60"
                  >
                    {REPEATS.map((k) => (
                      <option key={k} value={k}>
                        {r.repeat[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>

      {/* The list */}
      {grouped.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{r.empty}</p>
      ) : (
        <div className="flex-1 divide-y divide-border">
          {grouped.map((g) => (
            <section key={g.bucket} aria-label={r.buckets[g.bucket]}>
              <h4
                className={cn(
                  "px-5 pb-1 pt-3 text-[0.72rem] font-medium uppercase tracking-[0.08em]",
                  g.bucket === "overdue" ? "text-danger" : "text-muted"
                )}
              >
                {r.buckets[g.bucket]}
              </h4>
              <ul>
                <AnimatePresence initial={false}>
                  {g.items.map((it) => (
                    <motion.li
                      key={it.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease }}
                    >
                      <ReminderRow
                        item={it}
                        now={now}
                        overdue={g.bucket === "overdue"}
                        noteTitle={it.noteId ? notes[it.noteId] : undefined}
                        justDone={!!justDone[it.id]}
                        onComplete={() => void complete(it)}
                        onUndo={() => void undo(it)}
                        onSnooze={(c) => void snooze(it, c)}
                        onRemove={() => void remove(it)}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="border-t border-border px-5 py-2.5 text-[0.72rem] leading-relaxed text-muted">{r.delivery}</p>
    </Card>
  );
}

function ReminderRow({
  item,
  now,
  overdue,
  noteTitle,
  justDone,
  onComplete,
  onUndo,
  onSnooze,
  onRemove,
}: {
  item: ClientReminder;
  now: Date;
  overdue: boolean;
  noteTitle?: string;
  justDone: boolean;
  onComplete: () => void;
  onUndo: () => void;
  onSnooze: (c: SnoozeChoice) => void;
  onRemove: () => void;
}) {
  const m = useMessages();
  const r = m.reminders;
  const locale = useLocale();
  const [menu, setMenu] = useState(false);
  const temp = item.id.startsWith("temp-");
  const close = useCallback(() => setMenu(false), []);
  useEffect(() => {
    if (!menu) return;
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu, close]);

  return (
    <div className="group flex items-center gap-3 px-5 py-2.5">
      <button
        type="button"
        onClick={justDone ? undefined : onComplete}
        disabled={temp || justDone}
        aria-label={r.done}
        className={cn(
          "grid h-[1.125rem] w-[1.125rem] shrink-0 place-items-center rounded-full border transition-colors",
          justDone ? "border-success bg-success text-background" : "border-border-strong hover:border-accent"
        )}
      >
        {justDone && <Check className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", justDone && "text-muted-foreground line-through")}>{item.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-[0.75rem] text-muted-foreground">
          <span className={cn(overdue && !justDone && "text-danger")}>{formatWhen(new Date(item.dueAt), now, locale, item.zone)}</span>
          {item.repeat !== "none" && (
            <span className="flex items-center gap-1">
              <Repeat2 className="h-3 w-3" aria-hidden />
              {r.repeat[item.repeat]}
            </span>
          )}
          {noteTitle && (
            <Link href={`/brain?note=${item.noteId}`} className="truncate underline-offset-2 hover:underline">
              {r.about} « {noteTitle} »
            </Link>
          )}
        </p>
      </div>
      {justDone ? (
        <button type="button" onClick={onUndo} className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] text-accent hover:bg-surface-2">
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          {r.undo}
        </button>
      ) : (
        !temp && (
          <div className="relative flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenu((o) => !o);
              }}
              aria-label={r.snooze}
              aria-expanded={menu}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              <Clock3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={r.remove}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            {menu && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-lift" role="menu">
                {SNOOZES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onSnooze(c);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[0.8125rem] hover:bg-surface"
                  >
                    {r.snoozeTo[c]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

/** Whether this device may show a notification when a reminder comes due. */
function NotifyToggle() {
  const m = useMessages();
  const n = m.reminders.notify;
  const [state, setState] = useState<NotificationPermission | "unsupported" | null>(null);
  useEffect(() => {
    setState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  if (state === null) return null;
  if (state === "unsupported") return <BellOff className="h-4 w-4 text-muted" aria-label={n.unsupported} />;
  if (state === "granted")
    return (
      <span className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground" title={n.on}>
        <BellRing className="h-3.5 w-3.5 text-success" aria-hidden />
        <span className="hidden sm:inline">{n.on}</span>
      </span>
    );
  if (state === "denied")
    return (
      <span className="flex items-center gap-1.5 text-[0.75rem] text-muted" title={n.denied}>
        <BellOff className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  return (
    <button
      type="button"
      onClick={async () => setState(await Notification.requestPermission())}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <Bell className="h-3.5 w-3.5" aria-hidden />
      {n.enable}
    </button>
  );
}
