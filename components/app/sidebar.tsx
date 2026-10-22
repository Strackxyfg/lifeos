"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, LogOut, ArrowUpRight } from "lucide-react";
import { primaryNav, secondaryNav, workNav, type NavItem } from "@/lib/content/app-nav";
import { signOut } from "@/app/actions/sign-out";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { NAV_FEATURE, editionFor, includes, type Edition } from "@/lib/plans/editions";
import type { Profile } from "@/lib/user/profile";

/** The entries the edition opens; the server checks each page again. */
function visible(items: NavItem[], edition: Edition): NavItem[] {
  return items.filter((item) => {
    const feature = NAV_FEATURE[item.id];
    return !feature || includes(edition, feature);
  });
}

/** Desktop rail. */
export function Sidebar({ profile }: { profile: Profile }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col border-r border-border bg-surface/40 p-4 lg:flex">
      <SidebarContent profile={profile} />
    </aside>
  );
}

/** Shared content — reused by the desktop rail and the mobile drawer. */
export function SidebarContent({ profile, onNavigate }: { profile: Profile; onNavigate?: () => void }) {
  const pathname = usePathname();
  const m = useMessages();
  const { edition } = profile;
  const work = visible(workNav, edition);
  // What a richer edition would add here, named once rather than shown locked.
  const hidden = workNav.filter((item) => !work.includes(item));
  const next = hidden.length ? editionFor(NAV_FEATURE[hidden[0].id]) : null;
  // In Personal, the team space holds circles — family, friends.
  const labels = edition === "personal" ? { ...m.nav, team: m.nav.circles } : m.nav;

  return (
    <>
      <Link href="/hub" onClick={onNavigate} className="mb-6 flex items-center gap-2 px-2 font-medium tracking-tight">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
          <Sparkles className="h-4 w-4" />
        </span>
        LifeOS
      </Link>

      <button
        onClick={() => window.dispatchEvent(new Event("lifeos:command"))}
        className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{m.common.searchRun}</span>
        <Kbd className="hidden [@media(pointer:fine)]:inline-flex">⌘K</Kbd>
      </button>

      <NavGroup items={visible(primaryNav, edition)} pathname={pathname} labels={labels} onNavigate={onNavigate} />
      <div className="my-4 border-t border-border" />
      <NavGroup items={work} pathname={pathname} labels={labels} onNavigate={onNavigate} />
      {next && (
        <Link
          href="/billing#editions"
          onClick={onNavigate}
          className="mt-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground"
        >
          <ArrowUpRight className="h-4 w-4" aria-hidden />
          {fill(m.editions.moreWith, { edition: m.editions.names[next] })}
        </Link>
      )}
      <div className="my-4 border-t border-border" />
      <NavGroup items={secondaryNav} pathname={pathname} labels={labels} onNavigate={onNavigate} />

      <div className="mt-auto flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-sm font-medium">
          {profile.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{profile.name}</p>
          <p className="truncate text-[0.75rem] text-muted-foreground">{m.editions.names[edition]}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            aria-label={m.common.signOut}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </>
  );
}

function NavGroup({
  items,
  pathname,
  labels,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  labels: Record<NavItem["id"], string>;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.id}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground"
            )}
          >
            <item.icon className={cn("h-4 w-4", active && "text-accent")} />
            <span className="flex-1">{labels[item.id]}</span>
            {item.hint && (
              <span className="font-mono text-[0.7rem] text-muted opacity-0 transition-opacity group-hover:opacity-100">
                {item.hint}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
