"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Brain, Building2, CalendarCheck, CloudSun, ShieldCheck, Users, UsersRound } from "lucide-react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { TeamPageView } from "@/lib/team/view";
import { TeamBrain, TeamCheckin, TeamFeed, TeamPulse } from "./team-panels";
import { TeamMembers } from "./team-members";
import { FirstHire, WelcomePack } from "./first-hire";

type Tab = "feed" | "brain" | "checkin" | "pulse" | "members";
const TABS: { id: Tab; icon: typeof Activity }[] = [
  { id: "feed", icon: Activity },
  { id: "brain", icon: Brain },
  { id: "checkin", icon: CalendarCheck },
  { id: "pulse", icon: CloudSun },
  { id: "members", icon: Users },
];

/**
 * A team's space: what its members chose to share, the week's check-ins,
 * the anonymous pulse, and the people. The tab is kept in the address
 * (`#brain`), so a link can open straight on it and the back button works.
 */
export function TeamSpace({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("feed");

  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some((x) => x.id === h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const go = (id: Tab) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };

  const waitingCheckin = view.team.members > 1 && !view.mine;
  const badge: Partial<Record<Tab, number>> = {
    checkin: (waitingCheckin ? 1 : 0) + view.checkins.filter((c) => !c.mine && c.helpWanted && c.helpers.length === 0).length,
    pulse: view.pulse.mine ? 0 : 1,
  };

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent">
            {view.team.kind === "circle" ? <UsersRound className="h-6 w-6" aria-hidden /> : <Building2 className="h-6 w-6" aria-hidden />}
          </span>
          <div>
            <h1 className="text-h2 font-medium tracking-tight">{view.team.name}</h1>
            <p className="text-sm text-muted-foreground">
              {t.kinds[view.team.kind]} · {plural(locale, view.team.members, t.members)} · {t.roles[view.me.role]}
            </p>
          </div>
        </div>
        <Link href="/team?all=1" className="rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground">
          {t.list.yours}
        </Link>
      </header>

      <p className="mt-3 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        {t.privacy}
      </p>

      <nav role="tablist" aria-label={t.title} className="mt-5 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => go(id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm transition-colors",
              tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {t.tabs[id]}
            {(badge[id] ?? 0) > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-semibold text-accent-foreground">
                {badge[id]}
              </span>
            )}
            {tab === id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </nav>

      <section id={`panel-${tab}`} role="tabpanel" className="mt-5">
        {tab === "feed" && (
          <div className="space-y-3">
            <FirstHire view={view} />
            <WelcomePack view={view} />
            <TeamFeed view={view} />
          </div>
        )}
        {tab === "brain" && <TeamBrain view={view} />}
        {tab === "checkin" && <TeamCheckin view={view} />}
        {tab === "pulse" && <TeamPulse view={view} />}
        {tab === "members" && <TeamMembers view={view} />}
      </section>
    </div>
  );
}
