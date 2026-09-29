"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { browserZone, formatWhen, toLocalInput } from "@/lib/reminders/format";
import { planDealNext } from "@/app/actions/founder";

/**
 * A deal's next action: what, when, and a reminder at that moment if
 * wanted — the CRM's "next step" becomes something that comes back to you.
 */
export function DealNext({
  id,
  next,
  nextAt,
  reminder,
  enabled,
}: {
  id: string;
  next: string;
  nextAt: string | null;
  /** The open reminder about this deal, if any. */
  reminder: { dueAt: string } | null;
  /** Migration 013 applied. */
  enabled: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
  const c = m.founder.crm;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [text, setText] = useState(next);
  const [when, setWhen] = useState(nextAt ? toLocalInput(new Date(nextAt)) : "");
  const [remind, setRemind] = useState(!!reminder || !nextAt);
  const box = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const zone = typeof window === "undefined" ? "UTC" : browserZone();
  const label = nextAt && now ? fill(c.due, { when: formatWhen(new Date(nextAt), now, locale, zone) }) : null;

  return (
    <div ref={box} className="relative mt-2">
      <div className="flex items-center justify-between gap-2 text-[0.72rem]">
        <span className="min-w-0 truncate text-muted" title={next}>
          {next || "—"}
          {label && <span className="block text-[0.7rem] text-muted-foreground">{label}</span>}
        </span>
        {enabled && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={c.plan}
            title={reminder ? c.reminder : c.plan}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-2",
              reminder ? "text-accent" : "text-muted-foreground"
            )}
          >
            {reminder ? <BellRing className="h-3.5 w-3.5" aria-hidden /> : <CalendarClock className="h-3.5 w-3.5" aria-hidden />}
          </button>
        )}
      </div>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await planDealNext({
                id,
                next: text.trim(),
                nextAt: when ? new Date(when).toISOString() : null,
                remind: remind && !!when,
                zone: browserZone(),
              });
              if (r.ok) {
                toast(c.saved);
                setOpen(false);
                router.refresh();
              } else toast(m.founder.errors[r.code], "error");
            });
          }}
          className="glass absolute right-0 top-full z-30 mt-1 w-64 space-y-2 rounded-xl border border-border p-3 shadow-lift"
        >
          <label className="block">
            <span className="mb-1 block text-[0.72rem] text-muted-foreground">{c.next}</span>
            <input
              value={text}
              maxLength={120}
              onChange={(e) => setText(e.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-surface-2/60 px-2 text-[0.8125rem] outline-none focus:border-border-strong"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.72rem] text-muted-foreground">{c.when}</span>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-surface-2/60 px-2 text-[0.8125rem] outline-none focus:border-border-strong"
            />
          </label>
          <label className="flex items-center gap-2 text-[0.8125rem]">
            <input
              type="checkbox"
              checked={remind}
              disabled={!when}
              onChange={(e) => setRemind(e.target.checked)}
              className="h-4 w-4 accent-[hsl(var(--accent))]"
            />
            {c.remind}
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2.5 py-1 text-[0.8125rem] text-muted-foreground hover:text-foreground">
              {c.close}
            </button>
            <button type="submit" disabled={pending} className={buttonVariants({ size: "sm" })}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {c.save}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
