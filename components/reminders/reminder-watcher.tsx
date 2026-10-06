"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Check, Clock3, X } from "lucide-react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { plural } from "@/lib/i18n/config";
import { ease } from "@/lib/motion";
import { formatWhen } from "@/lib/reminders/format";
import { REMINDERS_EVENT, REMINDER_UPDATED_EVENT, type ClientReminder } from "@/lib/reminders/client";
import { completeReminder, markRemindersNotified, snoozeReminder } from "@/app/actions/reminders";

/** This occurrence was shown in this tab already (a new occurrence has a new due time). */
const SHOWN_KEY = "lifeos:reminders:shown";
/** At most this many at once; on a phone, one — three stacked covered half its screen. */
const MAX_ALERTS = 3;
const MAX_ALERTS_PHONE = 1;

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const q = matchMedia("(max-width: 639px)");
    const on = () => setPhone(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return phone;
}

const occurrence = (r: Pick<ClientReminder, "id" | "dueAt">) => `${r.id}@${r.dueAt}`;
const told = (r: ClientReminder) => !!r.notifiedAt && r.notifiedAt >= r.dueAt;

function readShown(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function rememberShown(keys: string[]) {
  try {
    const all = [...readShown(), ...keys].slice(-200);
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify(all));
  } catch {
    // Storage off: at worst an alert is shown again on the next page.
  }
}

/**
 * Tells the person when a reminder comes due, on whatever page they are:
 * an alert with "done" and "in 10 min", and — if they allowed it and the tab
 * is in the background — a system notification. Each occurrence is marked
 * as told on the server, so another tab, or the Telegram dispatcher, does
 * not tell it again.
 */
export function ReminderWatcher({ initial }: { initial: ClientReminder[] }) {
  const m = useMessages();
  const r = m.reminders;
  const locale = useLocale();
  const [list, setList] = useState<ClientReminder[]>(initial);
  const [alerts, setAlerts] = useState<ClientReminder[]>([]);
  const listRef = useRef(list);
  listRef.current = list;

  // The dashboard's panel keeps the list current without a reload.
  useEffect(() => {
    const onList = (e: Event) => setList((e as CustomEvent<ClientReminder[]>).detail);
    window.addEventListener(REMINDERS_EVENT, onList);
    return () => window.removeEventListener(REMINDERS_EVENT, onList);
  }, []);

  const check = useCallback(() => {
    const now = Date.now();
    const shown = readShown();
    const due = listRef.current.filter(
      (x) => !x.done && Date.parse(x.dueAt) <= now && !told(x) && !shown.has(occurrence(x)) && !x.id.startsWith("temp-")
    );
    if (due.length === 0) return;
    rememberShown(due.map(occurrence));
    setAlerts((a) => {
      const known = new Set(a.map(occurrence));
      return [...a, ...due.filter((x) => !known.has(occurrence(x)))];
    });
    void markRemindersNotified(due.map((x) => x.id));

    // In the background, and allowed: the system's own notification.
    if (document.visibilityState === "hidden" && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const x of due.slice(0, MAX_ALERTS)) {
        const options: NotificationOptions = { body: x.title, tag: occurrence(x), data: { url: "/dashboard" } };
        const viaWorker = "serviceWorker" in navigator ? navigator.serviceWorker.getRegistration() : Promise.resolve(undefined);
        viaWorker
          .then(async (reg) => {
            if (reg) await reg.showNotification(r.alertTitle, options);
            else new Notification(r.alertTitle, options);
          })
          .catch(() => {});
      }
    }
  }, [r.alertTitle]);

  // On time: a timer to the next due moment, a slow heartbeat as a safety
  // net (a sleeping laptop's timers do not fire), and on coming back to the tab.
  useEffect(() => {
    check();
    const upcoming = list
      .filter((x) => !x.done && !told(x) && Date.parse(x.dueAt) > Date.now())
      .map((x) => Date.parse(x.dueAt) - Date.now());
    const next = upcoming.length ? Math.min(...upcoming) : null;
    // setTimeout overflows past ~24.8 days; nothing so far is on this page's list anyway.
    const exact = next !== null && next < 2 ** 31 - 1 ? setTimeout(check, next + 250) : null;
    const beat = setInterval(check, 30_000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (exact) clearTimeout(exact);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [list, check]);

  // The tab's title counts what waits, like a mail client.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = alerts.length ? `(${alerts.length}) ${base}` : base;
  }, [alerts.length]);

  const drop = (x: ClientReminder) => setAlerts((a) => a.filter((y) => occurrence(y) !== occurrence(x)));
  const updated = (next: ClientReminder) => {
    window.dispatchEvent(new CustomEvent(REMINDER_UPDATED_EVENT, { detail: next }));
    setList((l) => l.map((y) => (y.id === next.id ? next : y)).filter((y) => !y.done));
  };

  const done = async (x: ClientReminder) => {
    drop(x);
    const res = await completeReminder(x.id);
    if (res.ok) updated(res.data);
  };
  const later = async (x: ClientReminder) => {
    drop(x);
    const res = await snoozeReminder(x.id, "10m");
    if (res.ok) updated(res.data);
  };

  const phone = usePhone();
  const shown = alerts.slice(0, phone ? MAX_ALERTS_PHONE : MAX_ALERTS);
  const hidden = alerts.length - shown.length;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[105] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[min(22rem,calc(100vw-2rem))]"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {shown.map((x) => (
          <motion.div
            key={occurrence(x)}
            role="alert"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.28, ease }}
            className="pointer-events-auto rounded-xl border border-border-strong bg-surface-2/95 p-3.5 shadow-lift backdrop-blur"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                <BellRing className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{r.alertTitle}</p>
                <p className="mt-0.5 text-sm font-medium leading-snug">{x.title}</p>
                <p className="text-[0.75rem] text-muted-foreground">{formatWhen(new Date(x.dueAt), new Date(), locale, x.zone)}</p>
              </div>
              <button
                type="button"
                onClick={() => drop(x)}
                aria-label={r.dismiss}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void done(x)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-accent-foreground"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                {r.done}
              </button>
              <button
                type="button"
                onClick={() => void later(x)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground"
              >
                <Clock3 className="h-3.5 w-3.5" aria-hidden />
                {r.later}
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {hidden > 0 && (
        <p className="pointer-events-auto rounded-lg bg-surface-2/95 px-3 py-1.5 text-center text-[0.75rem] text-muted-foreground shadow-lift">
          {plural(locale, hidden, r.more)}
        </p>
      )}
    </div>
  );
}
