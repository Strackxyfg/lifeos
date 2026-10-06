"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Brain, Camera, ChevronLeft, ChevronRight, Clock3, Command, CornerDownLeft, Download, History,
  Loader2, Menu, Moon, RotateCcw, Sun, Sunrise, Sunset, X,
} from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { Notifications } from "@/components/app/notifications";
import { QuickCapture } from "@/components/app/quick-capture";
import { SidebarContent } from "@/components/app/sidebar";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn, formatCurrency } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { DISTRICTS, DISTRICT_IDS, districtById, type DistrictId } from "@/lib/hub/districts";
import { hubBadges, hubStats, type HubFacts, type HubStat } from "@/lib/hub/summary";
import type { PageRect } from "@/lib/hub/framing";
import type { SkyPhase } from "@/lib/hub/sky";
import type { SunTimes } from "@/lib/hub/solar";
import type { Alert } from "@/lib/data/alerts";
import type { Profile } from "@/lib/user/profile";
import { DISTRICT_ICONS } from "./district-icons";

/* ── Top bar ─────────────────────────────────────────────────────── */

export function HubTopBar({ profile, alerts, greeting }: { profile: Profile; alerts: Alert[]; greeting: string }) {
  const m = useMessages();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label={m.hub.menu}
            className="glass grid h-10 w-10 place-items-center rounded-xl border border-border text-foreground shadow-card transition-colors hover:bg-surface-2"
          >
            <Menu className="h-[1.125rem] w-[1.125rem]" />
          </button>
          {/* A greeting is a nicety a phone turned sideways has no room for. */}
          <div className="glass hidden rounded-xl border border-border px-3.5 py-2 shadow-card sm:block [@media(max-height:500px)]:!hidden">
            <p className="text-[0.8125rem] text-muted-foreground">LifeOS</p>
            {/* The server's clock is not the person's (it runs in UTC): the
                browser's hour wins, without a hydration warning. */}
            <p className="-mt-0.5 text-[0.9375rem] font-medium tracking-tight" suppressHydrationWarning>
              {greeting}, {profile.firstName}
            </p>
          </div>
        </div>
        <div data-hub-bar className="glass pointer-events-auto flex items-center gap-1 rounded-xl border border-border p-1 shadow-card">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("lifeos:command"))}
            // Keyboard hints only where there is a keyboard to go with them (not a phone held sideways).
            className="hidden items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:[@media(pointer:fine)]:flex"
          >
            <Command className="h-3.5 w-3.5" />
            <Kbd>⌘K</Kbd>
          </button>
          <LanguageSwitch />
          <ThemeToggle />
          <Notifications alerts={alerts} />
          <QuickCapture />
        </div>
      </header>

      <AnimatePresence>
        {drawer && (
          <motion.div className="fixed inset-0 z-[80]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={m.hub.menu}
              className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto overscroll-contain border-r border-border bg-surface p-4 shadow-lift"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease }}
            >
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label={m.common.closeMenu}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              <SidebarContent profile={profile} onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ── The sky of the moment, and the preview of another hour ──────── */

const PHASE_ICON: Record<SkyPhase, typeof Sun> = {
  night: Moon,
  dawn: Sunrise,
  sunrise: Sunrise,
  morning: Sun,
  noon: Sun,
  afternoon: Sun,
  golden: Sunset,
  sunset: Sunset,
  dusk: Sunset,
};

export function SkyChip({
  phase,
  times,
  city,
  previewMinutes,
  nowMinutes,
  onPreview,
}: {
  phase: SkyPhase;
  times: SunTimes;
  city: string | null;
  previewMinutes: number | null;
  nowMinutes: number;
  onPreview: (minutes: number | null) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const clock = (d: Date) => d.toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" });
  const hhmm = (min: number) => {
    const d = new Date();
    d.setHours(Math.floor(min / 60), min % 60, 0, 0);
    return clock(d);
  };
  const minutesOf = (d: Date | null) => (d ? d.getHours() * 60 + d.getMinutes() : null);

  // Whichever comes next is the most useful: sunset by day, sunrise at night.
  const now = new Date();
  const next =
    times.polar === "day"
      ? m.hub.polarDay
      : times.polar === "night"
        ? m.hub.polarNight
        : times.sunset && now < times.sunset && times.sunrise && now > times.sunrise
          ? fill(m.hub.sunset, { time: clock(times.sunset) })
          : times.sunrise
            ? fill(m.hub.sunrise, { time: clock(times.sunrise) })
            : "";

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const Icon = PHASE_ICON[phase];
  const presets: { label: string; min: number | null; icon: typeof Sun }[] = [
    { label: m.hub.phase.sunrise, min: times.sunrise ? (minutesOf(times.sunrise)! + 10) % 1440 : null, icon: Sunrise },
    { label: m.hub.phase.noon, min: minutesOf(times.noon), icon: Sun },
    // A quarter of an hour before: the last warm light, the sun still on the horizon.
    { label: m.hub.phase.sunset, min: times.sunset ? (minutesOf(times.sunset)! - 15 + 1440) % 1440 : null, icon: Sunset },
    { label: m.hub.phase.night, min: times.sunset ? (minutesOf(times.sunset)! + 120) % 1440 : 23 * 60, icon: Moon },
  ];

  return (
    <div ref={box} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "glass flex items-center gap-2 rounded-xl border px-3 py-2 text-left shadow-card transition-colors hover:bg-surface-2",
          previewMinutes !== null ? "border-accent/60" : "border-border"
        )}
      >
        <Icon className="h-4 w-4 text-accent" aria-hidden />
        <span className="text-[0.8125rem] font-medium">
          {previewMinutes !== null ? fill(m.hub.previewing, { time: hhmm(previewMinutes) }) : m.hub.phase[phase]}
        </span>
        {previewMinutes === null && next && <span className="hidden text-[0.8125rem] text-muted-foreground sm:inline">· {next}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease }}
            className="glass absolute left-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-border p-4 shadow-lift"
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <Clock3 className="h-4 w-4 text-accent" aria-hidden />
              {m.hub.preview}
            </p>
            <input
              type="range"
              min={0}
              max={1435}
              step={5}
              value={previewMinutes ?? nowMinutes}
              onChange={(e) => onPreview(Number(e.target.value))}
              aria-label={m.hub.preview}
              aria-valuetext={hhmm(previewMinutes ?? nowMinutes)}
              className="mt-3 w-full accent-[hsl(var(--accent))]"
            />
            <div className="mt-1 flex justify-between text-[0.7rem] text-muted">
              <span>00:00</span>
              <span className="font-medium text-foreground">{hhmm(previewMinutes ?? nowMinutes)}</span>
              <span>23:55</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {presets
                .filter((p) => p.min !== null)
                .map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => onPreview(p.min)}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <p.icon className="h-3.5 w-3.5" aria-hidden />
                    {p.label}
                  </button>
                ))}
            </div>
            {previewMinutes !== null && (
              <button
                type="button"
                onClick={() => onPreview(null)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[0.8125rem] font-medium text-accent-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {m.hub.now}
              </button>
            )}
            <p className="mt-3 text-[0.72rem] leading-relaxed text-muted">
              {city ? fill(m.hub.skyFor, { city }) : m.hub.skyForZone}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Photo mode ──────────────────────────────────────────────────── */

export interface PhotoState {
  phase: "preparing" | "compiling" | "tracing" | "done" | "failed";
  samples: number;
  target: number;
  reason?: "unsupported" | "error";
}

/** Starts a ray-traced photo of the current view. */
export function PhotoButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  const m = useMessages();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={m.hub.photo.label}
      title={m.hub.photo.label}
      className={cn(
        "glass pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2 text-[0.8125rem] font-medium shadow-card transition-colors hover:bg-surface-2",
        active ? "border-accent/60" : "border-border"
      )}
    >
      <Camera className="h-4 w-4 text-accent" aria-hidden />
      <span className="hidden sm:inline">{m.hub.photo.button}</span>
    </button>
  );
}

/** While a photo is traced: how far along, save it, close it. */
export function PhotoPanel({
  state,
  onSave,
  onClose,
}: {
  state: PhotoState;
  onSave: () => Promise<void>;
  onClose: () => void;
}) {
  const m = useMessages();
  const [saving, setSaving] = useState(false);
  const p = m.hub.photo;
  const pct = state.target > 0 ? Math.min(100, (state.samples / state.target) * 100) : 0;
  const status =
    state.phase === "preparing"
      ? p.preparing
      : state.phase === "compiling"
        ? p.compiling
        : state.phase === "failed"
          ? state.reason === "unsupported"
            ? p.unsupported
            : p.failed
          : state.phase === "done"
            ? fill(p.done, { total: String(state.target) })
            : fill(p.tracing, { n: String(state.samples), total: String(state.target) });
  const busy = state.phase === "preparing" || state.phase === "compiling";
  return (
    <motion.div
      role="dialog"
      aria-label={p.title}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.22, ease }}
      className="glass pointer-events-auto absolute inset-x-3 bottom-4 z-40 mx-auto max-w-md rounded-2xl border border-border p-4 shadow-lift sm:bottom-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Camera className="h-4 w-4 text-accent" aria-hidden />
            {p.title}
          </p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground" aria-live="polite">
            {busy && <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin align-[-2px]" aria-hidden />}
            {status}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={p.close} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {state.phase !== "failed" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={state.target} aria-valuenow={state.samples}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="mt-3 text-[0.72rem] leading-relaxed text-muted">{p.hint}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          {p.close} <Kbd className="ml-1 hidden [@media(pointer:fine)]:inline-flex">Esc</Kbd>
        </button>
        <button
          type="button"
          disabled={busy || state.phase === "failed" || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave();
            } finally {
              setSaving(false);
            }
          }}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-accent-foreground disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {saving ? p.saving : p.save}
        </button>
      </div>
    </motion.div>
  );
}

/* ── Bottom cards ────────────────────────────────────────────────── */

export function HubCards({
  facts,
  resume,
  onVisit,
  hidden,
  boxRef,
}: {
  facts: HubFacts;
  resume: DistrictId | null;
  onVisit: (id: DistrictId) => void;
  hidden: boolean;
  /** The row, measured by the page: the island is framed above it. */
  boxRef?: React.Ref<HTMLDivElement>;
}) {
  const m = useMessages();
  const locale = useLocale();
  const c = m.hub.cards;
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" });

  const todayLines: string[] = [];
  if (facts.reminders?.overdue) todayLines.push(plural(locale, facts.reminders.overdue, c.overdue));
  if (facts.reminders?.next) todayLines.push(fill(c.nextReminder, { title: facts.reminders.next.title, time: clock(facts.reminders.next.dueAt) }));
  todayLines.push(plural(locale, facts.tasksOpen, c.tasksOpen));

  const brainLines = [plural(locale, facts.notes, c.notes)];
  if (facts.reviewDue) brainLines.push(plural(locale, facts.reviewDue, c.reviewDue));
  if (facts.tensions) brainLines.push(plural(locale, facts.tensions, c.tensions));
  if (!facts.reviewDue && !facts.tensions) brainLines.push(c.calm);

  const ResumeIcon = resume ? DISTRICT_ICONS[resume] : History;

  return (
    <motion.div
      ref={boxRef}
      initial={false}
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? 24 : 0 }}
      transition={{ duration: 0.35, ease }}
      className={cn(
        "absolute inset-x-0 bottom-0 z-30 flex snap-x snap-mandatory scroll-px-3 gap-2.5 overflow-x-auto overscroll-x-contain p-3 sm:justify-center sm:p-4 [scrollbar-width:none] [@media(max-height:500px)]:p-2",
        hidden ? "pointer-events-none" : "pointer-events-auto"
      )}
      aria-hidden={hidden}
    >
      <Card title={c.today} icon={DISTRICT_ICONS.today} lines={todayLines} onClick={() => onVisit("today")} />
      <Card title={c.brain} icon={Brain} lines={brainLines} onClick={() => onVisit("brain")} />
      <Card
        title={c.resume}
        icon={ResumeIcon}
        lines={[resume ? m.hub.districts[resume].name : c.resumeEmpty]}
        onClick={resume ? () => onVisit(resume) : undefined}
      />
    </motion.div>
  );
}

function Card({ title, icon: Icon, lines, onClick }: { title: string; icon: typeof Sun; lines: string[]; onClick?: () => void }) {
  const inner = (
    <>
      <span className="flex items-center gap-2 text-[0.75rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-accent" aria-hidden />
        {title}
      </span>
      {lines.map((l, i) => (
        <span
          key={i}
          className={cn(
            "block truncate",
            // A short screen (a phone sideways) keeps each card to its headline.
            i === 0 ? "mt-1.5 text-sm font-medium [@media(max-height:500px)]:mt-0.5" : "text-[0.8125rem] text-muted-foreground [@media(max-height:500px)]:hidden"
          )}
        >
          {l}
        </span>
      ))}
    </>
  );
  // A column: a button would otherwise centre a shorter card's lines vertically.
  const cls =
    "glass flex w-[15.5rem] shrink-0 snap-start flex-col rounded-2xl border border-border px-4 py-3 text-left shadow-card [@media(max-height:500px)]:w-[13rem] [@media(max-height:500px)]:rounded-xl [@media(max-height:500px)]:py-2";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:bg-surface-2")}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/* ── The panel of a building ─────────────────────────────────────── */

function formatStat(s: HubStat, locale: "en" | "fr"): string {
  if (s.format === "money") return formatCurrency(s.value, locale);
  if (s.format === "percent") return `${s.value}%`;
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US").format(s.value);
}

export function FocusPanel({
  id,
  facts,
  onEnter,
  onBack,
  onStep,
  entering,
  onLayout,
}: {
  id: DistrictId | null;
  facts: HubFacts;
  onEnter: () => void;
  onBack: () => void;
  onStep: (step: 1 | -1) => void;
  entering: boolean;
  /** Where the panel is on the page (null once closed), so the camera frames the building beside it. */
  onLayout?: (rect: PageRect | null) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const enterRef = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement | null>(null);
  const layout = useRef(onLayout);
  layout.current = onLayout;
  const open = id !== null;
  /** The sheet is taller than the room it has: its actions get a backing so the scrolled text does not run under them. */
  const [scrolls, setScrolls] = useState(false);

  // Keyboard users land on the main action when a building opens.
  useEffect(() => {
    if (id) enterRef.current?.focus({ preventScroll: true });
  }, [id]);

  // Measured before the first paint and whenever it changes size. Offsets,
  // not the on-screen box: the panel slides in, and the slide is not where it rests.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const report = () => {
      layout.current?.({ top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight });
      setScrolls(el.scrollHeight > el.clientHeight + 1);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    // The content changes height without the panel changing size (another building, the same sheet).
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      ro.disconnect();
      layout.current?.(null);
    };
  }, [open]);

  // On a phone the panel is a sheet: a swipe sideways goes to the next
  // building, a swipe down (from its top) closes it. Touch events, because
  // they still arrive when the browser scrolls the sheet.
  const swipe = useRef<{ x: number; y: number; t: number; atTop: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipe.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, t: performance.now(), atTop: (panel.current?.scrollTop ?? 0) <= 0 } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!s || !t || entering || performance.now() - s.t > 700) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > 1.6 * Math.abs(dy)) onStep(dx < 0 ? 1 : -1);
    else if (s.atTop && dy > 72 && dy > 1.6 * Math.abs(dx)) onBack();
  };

  return (
    <AnimatePresence>
      {id && (
        <motion.section
          key="panel"
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="hub-panel-title"
          initial={{ opacity: 0, x: 24, y: 0 }}
          animate={{ opacity: entering ? 0 : 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.32, ease }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => (swipe.current = null)}
          className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-40 max-h-[58dvh] touch-pan-y overflow-y-auto overscroll-contain rounded-2xl border border-border p-5 pt-3 shadow-lift sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-20 sm:max-h-[calc(100dvh-6rem)] sm:w-[23rem] sm:pt-5"
        >
          {/* The sheet's handle: it can be swiped. */}
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-foreground/20 sm:hidden" aria-hidden />
          <PanelBody id={id} facts={facts} locale={locale} />
          {/* The actions stay in reach: on a small phone the sheet scrolls, they do not. */}
          <div
            className={cn(
              "sticky -bottom-5 z-10 -mx-5 -mb-5 mt-3 rounded-b-2xl px-5 pb-5 pt-2",
              scrolls && "bg-surface/85 backdrop-blur-md"
            )}
          >
          <div className="flex items-center gap-2">
            <button
              ref={enterRef}
              type="button"
              onClick={onEnter}
              disabled={entering}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground shadow-glow transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {m.hub.enter}
              <ArrowRight className="h-4 w-4" aria-hidden />
              <span className="ml-1 hidden items-center gap-0.5 rounded bg-white/15 px-1 py-0.5 text-[0.65rem] sm:[@media(pointer:fine)]:flex">
                <CornerDownLeft className="h-3 w-3" aria-hidden />
              </span>
            </button>
            <button
              type="button"
              onClick={onBack}
              aria-label={m.hub.back}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface/60 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{m.hub.back}</span>
              <Kbd className="ml-1 hidden sm:[@media(pointer:fine)]:inline-flex">Esc</Kbd>
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[0.75rem] text-muted">
            <button
              type="button"
              onClick={() => onStep(-1)}
              className="-ml-1.5 flex min-h-9 min-w-0 items-center gap-1 rounded-md px-1.5 hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{m.hub.districts[neighbourOf(id, -1)].name}</span>
            </button>
            <span className="shrink-0 px-2 tabular-nums">
              {DISTRICT_IDS.indexOf(id) + 1} / {DISTRICT_IDS.length}
            </span>
            <button
              type="button"
              onClick={() => onStep(1)}
              className="-mr-1.5 flex min-h-9 min-w-0 items-center gap-1 rounded-md px-1.5 hover:text-foreground"
            >
              <span className="truncate">{m.hub.districts[neighbourOf(id, 1)].name}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </button>
          </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function neighbourOf(id: DistrictId, step: 1 | -1): DistrictId {
  const i = DISTRICT_IDS.indexOf(id);
  return DISTRICT_IDS[(i + step + DISTRICT_IDS.length) % DISTRICT_IDS.length];
}

function PanelBody({ id, facts, locale }: { id: DistrictId; facts: HubFacts; locale: "en" | "fr" }) {
  const m = useMessages();
  const d = m.hub.districts[id];
  const Icon = DISTRICT_ICONS[id];
  const stats = hubStats(id, facts);
  const shortcut = districtById(id).hint;
  return (
    <motion.div key={id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease }}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="hub-panel-title" className="truncate text-lg font-medium tracking-tight">
            {d.name}
          </h2>
          <p className="hidden font-mono text-[0.7rem] text-muted [@media(pointer:fine)]:block">{shortcut}</p>
        </div>
      </div>
      {/* A short phone keeps the building in view: the figures matter more than the sentence. */}
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground sm:text-sm max-sm:[@media(max-height:680px)]:hidden [@media(max-height:500px)]:hidden">
        {d.desc}
      </p>
      {stats.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:mt-4">
          {stats.map((s) => (
            <div key={s.key} className="rounded-xl border border-border bg-surface/50 px-3 py-2 sm:py-2.5">
              <dt className="truncate text-[0.72rem] text-muted-foreground">{m.hub.stats[s.key]}</dt>
              <dd className={cn("mt-0.5 text-base font-medium tabular-nums tracking-tight sm:text-lg", s.alert && "text-accent")}>
                {formatStat(s, locale)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </motion.div>
  );
}

/* ── Without 3D ──────────────────────────────────────────────────── */

export function HubFallback({ facts, reason, onRetry }: { facts: HubFacts; reason: "unsupported" | "lost"; onRetry?: () => void }) {
  const m = useMessages();
  const locale = useLocale();
  const badges = hubBadges(facts);
  return (
    <div className="relative z-10 mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-4 pb-10 pt-24">
      <h1 className="text-h2 font-medium tracking-tight">{reason === "lost" ? m.hub.lost : m.hub.fallbackTitle}</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">{m.hub.fallbackBody}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {m.hub.retry}
        </button>
      )}
      <nav aria-label={m.hub.places} className="mt-8 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {DISTRICTS.map((d) => {
          const Icon = DISTRICT_ICONS[d.id];
          const count = badges[d.id] ?? 0;
          return (
            <Link
              key={d.id}
              href={d.href}
              className="glass group rounded-2xl border border-border p-4 shadow-card transition-colors hover:bg-surface-2"
            >
              <span className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent">
                  <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden />
                </span>
                <span className="font-medium">{m.hub.districts[d.id].name}</span>
                {count > 0 && (
                  <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[0.7rem] font-medium text-accent-foreground">
                    {plural(locale, count, m.hub.waiting)}
                  </span>
                )}
              </span>
              <span className="mt-2 block text-[0.8125rem] leading-relaxed text-muted-foreground">{m.hub.districts[d.id].desc}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
