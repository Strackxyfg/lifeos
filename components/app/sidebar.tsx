"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, LogOut } from "lucide-react";
import { primaryNav, secondaryNav, type NavItem } from "@/lib/content/app-nav";
import { signOut } from "@/app/actions/sign-out";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useMessages } from "@/lib/i18n/client";
import type { Profile } from "@/lib/user/profile";

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

  return (
    <>
      <Link href="/dashboard" onClick={onNavigate} className="mb-6 flex items-center gap-2 px-2 font-medium tracking-tight">
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
        <Kbd>⌘K</Kbd>
      </button>

      <NavGroup items={primaryNav} pathname={pathname} labels={m.nav} onNavigate={onNavigate} />
      <div className="my-4 border-t border-border" />
      <NavGroup items={secondaryNav} pathname={pathname} labels={m.nav} onNavigate={onNavigate} />

      <div className="mt-auto flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-sm font-medium">
          {profile.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{profile.name}</p>
          <p className="truncate text-[0.75rem] text-muted-foreground">{m.common.proPlan}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            aria-label={m.common.signOut}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
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
