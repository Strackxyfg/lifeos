"use client";

import { Command } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { MobileNav } from "./mobile-nav";
import { Notifications } from "./notifications";
import { QuickCapture } from "./quick-capture";
import type { Profile } from "@/lib/user/profile";
import type { Alert } from "@/lib/data/alerts";
import { useMessages } from "@/lib/i18n/client";

export function Topbar({ profile, alerts }: { profile: Profile; alerts: Alert[] }) {
  const m = useMessages();
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 lg:px-6">
      <div className="flex items-center gap-2">
        <MobileNav profile={profile} />
        <button
          onClick={() => window.dispatchEvent(new Event("lifeos:command"))}
          aria-label={m.command.title}
          className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface/60 px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          <Command className="h-3.5 w-3.5" />
          {/* A keyboard shortcut means nothing on a phone, and it pushed the bar past a 375 px screen. */}
          <Kbd className="hidden sm:[@media(pointer:fine)]:inline-flex">⌘K</Kbd>
        </button>
        <div className="hidden text-sm text-muted-foreground lg:block">
          <span className="text-foreground">{profile.firstName}</span> · LifeOS
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <LanguageSwitch />
        <ThemeToggle />
        <Notifications alerts={alerts} />
        <QuickCapture />
      </div>
    </header>
  );
}
