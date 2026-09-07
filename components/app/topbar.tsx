"use client";

import { Command, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { MobileNav } from "./mobile-nav";
import { Notifications } from "./notifications";
import { cn } from "@/lib/utils";
import { useMessages } from "@/lib/i18n/client";
import type { Profile } from "@/lib/user/profile";
import type { Alert } from "@/lib/data/alerts";

export function Topbar({ profile, alerts }: { profile: Profile; alerts: Alert[] }) {
  const m = useMessages();
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 lg:px-6">
      <div className="flex items-center gap-2">
        <MobileNav profile={profile} />
        <button
          onClick={() => window.dispatchEvent(new Event("lifeos:command"))}
          className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          <Command className="h-3.5 w-3.5" />
          <Kbd>⌘K</Kbd>
        </button>
        <div className="hidden text-sm text-muted-foreground lg:block">
          <span className="text-foreground">{profile.firstName}</span> · LifeOS
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <LanguageSwitch />
        <ThemeToggle />
        <Notifications alerts={alerts} />
        <a href="/onboarding" className={cn(buttonVariants({ size: "sm" }))}>
          <Plus className="h-4 w-4" /> {m.common.newWorkspace}
        </a>
      </div>
    </header>
  );
}
