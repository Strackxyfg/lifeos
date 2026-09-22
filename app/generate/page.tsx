import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, NotebookPen } from "lucide-react";
import { Generator } from "@/components/generation/generator";
import { getNotionStatus } from "@/lib/notion/connection";
import { selectBlueprints } from "@/lib/notion/blueprint";
import { getProfile } from "@/lib/user/profile";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Notion export",
  robots: { index: false, follow: false },
};

/**
 * The optional Notion export: builds a Notion workspace shaped by the
 * person's profile. Reached from Settings, never from onboarding.
 */
export default async function GeneratePage() {
  const [notion, profile, locale, m] = await Promise.all([
    getNotionStatus(),
    getProfile(),
    getLocale(),
    getMessages(),
  ]);

  return (
    <LocaleProvider locale={locale} messages={m}>
      {notion.connected ? (
        // Computed here from the same function the build uses, so the list
        // shown before building is exactly what gets built.
        <Generator planned={selectBlueprints(profile.areas).map((b) => b.title)} />
      ) : (
        <div className="flex min-h-dvh items-center justify-center px-6">
          <div className="max-w-md text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border bg-surface">
              <NotebookPen className="h-5 w-5 text-accent" />
            </span>
            <h1 className="mt-5 text-h2 tracking-tight">{m.notionBuild.notConnectedTitle}</h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">{m.notionBuild.notConnected}</p>
            <Link href="/settings#connections" className={cn(buttonVariants({ size: "lg" }), "mt-8")}>
              <ArrowLeft className="h-4 w-4" /> {m.notionBuild.toSettings}
            </Link>
          </div>
        </div>
      )}
    </LocaleProvider>
  );
}
