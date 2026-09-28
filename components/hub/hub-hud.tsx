"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Brain, ChevronLeft, ChevronRight, Clock3, Command, CornerDownLeft, History, Menu, Moon,
  RotateCcw, Sun, Sunrise, Sunset, X,
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
import type { SkyPhase } from "@/lib/hub/sky";
import type { SunTimes } from "@/lib/hub/solar";
import type { Alert } from "@/lib/data/alerts";
import type { Profile } from "@/lib/user/profile";
import { DISTRICT_ICONS } from "./district-icons";

/* ── Top bar ─────────────────────────────────────────────────────── */

export function HubTopBar({ profile, alerts, greeting }: { profile: Profile; alerts: Alert[]; greeting: string }) {
  const m = useMessages();
  const [drawer, setDrawer] = useState(false);
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
          <div className="glass hidden rounded-xl border border-border px-3.5 py-2 shadow-card sm:block">
            <p className="text-[0.8125rem] text-muted-foreground">LifeOS</p>
            {/* The server's clock is not the person's (it runs in UTC): the
                browser's hour wins, without a hydration warning. */}
            <p className="-mt-0.5 text-[0.9375rem] font-medium tracking-tight" suppressHydrationWarning>
              {greeting}, {profile.firstName}
            </p>
          </div>
        </div>
        <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl border border-border p-1 shadow-card">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("lifeos:command"))}
            className="hidden items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:flex"
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
              className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-border bg-surface p-4 shadow-lift"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease }}
            >
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label={m.hub.back}
                className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
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

/* ── Bottom cards ────────────────────────────────────────────────── */

export function HubCards({
  facts,
  resume,
  onVisit,
  hidden,
}: {
  facts: HubFacts;
  resume: DistrictId | null;
  onVisit: (id: DistrictId) => void;
  hidden: boolean;
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
      initial={false}
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? 24 : 0 }}
      transition={{ duration: 0.35, ease }}
      className={cn(
        "absolute inset-x-0 bottom-0 z-30 flex gap-2.5 overflow-x-auto p-3 sm:justify-center sm:p-4 [scrollbar-width:none]",
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
        <span key={i} className={cn("block truncate", i === 0 ? "mt-1.5 text-sm font-medium" : "text-[0.8125rem] text-muted-foreground")}>
          {l}
        </span>
      ))}
    </>
  );
  const cls = "glass w-[15.5rem] shrink-0 rounded-2xl border border-border px-4 py-3 text-left shadow-card";
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
}: {
  id: DistrictId | null;
  facts: HubFacts;
  onEnter: () => void;
  onBack: () => void;
  onStep: (step: 1 | -1) => void;
  entering: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
  const enterRef = useRef<HTMLButtonElement>(null);

  // Keyboard users land on the main action when a building opens.
  useEffect(() => {
    if (id) enterRef.current?.focus({ preventScroll: true });
  }, [id]);

  return (
    <AnimatePresence>
      {id && (
        <motion.section
          key="panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="hub-panel-title"
          initial={{ opacity: 0, x: 24, y: 0 }}
          animate={{ opacity: entering ? 0 : 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.32, ease }}
          className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-40 max-h-[58dvh] overflow-y-auto rounded-2xl border border-border p-5 shadow-lift sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-20 sm:w-[23rem]"
        >
          <PanelBody id={id} facts={facts} locale={locale} />
          <div className="mt-5 flex items-center gap-2">
            <button
              ref={enterRef}
              type="button"
              onClick={onEnter}
              disabled={entering}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground shadow-glow transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {m.hub.enter}
              <ArrowRight className="h-4 w-4" aria-hidden />
              <span className="ml-1 hidden items-center gap-0.5 rounded bg-white/15 px-1 py-0.5 text-[0.65rem] sm:flex">
                <CornerDownLeft className="h-3 w-3" aria-hidden />
              </span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface/60 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{m.hub.back}</span>
              <Kbd className="ml-1 hidden sm:inline-flex">Esc</Kbd>
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between text-[0.75rem] text-muted">
            <button type="button" onClick={() => onStep(-1)} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:text-foreground">
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              {m.hub.districts[neighbourOf(id, -1)].name}
            </button>
            <span className="tabular-nums">
              {DISTRICT_IDS.indexOf(id) + 1} / {DISTRICT_IDS.length}
            </span>
            <button type="button" onClick={() => onStep(1)} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:text-foreground">
              {m.hub.districts[neighbourOf(id, 1)].name}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
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
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d.desc}</p>
      {stats.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.key} className="rounded-xl border border-border bg-surface/50 px-3 py-2.5">
              <dt className="truncate text-[0.72rem] text-muted-foreground">{m.hub.stats[s.key]}</dt>
              <dd className={cn("mt-0.5 text-lg font-medium tabular-nums tracking-tight", s.alert && "text-accent")}>
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
