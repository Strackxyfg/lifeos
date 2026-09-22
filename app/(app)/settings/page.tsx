import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Download, NotebookPen, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { NotionConnect } from "@/components/app/notion-connect";
import { SettingsProfileForm } from "@/components/app/settings-profile-form";
import { DeleteData } from "@/components/app/delete-data";
import { getNotionStatus } from "@/lib/notion/connection";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getProfile } from "@/lib/user/profile";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Settings" };

/**
 * Only what is real.
 *
 * This page used to list Google Calendar, Gmail, Slack, GitHub and Stripe
 * with switches — three of them "Connected" by default for every new account
 * — though none of those integrations existed. It offered a weekly review
 * email and an 8am briefing that nothing ever sent, showed a hardcoded
 * "America/Los_Angeles" timezone, and had a Delete button wired to nothing.
 * All of it is gone. What remains works.
 */
export default async function SettingsPage() {
  const [profile, m, notion] = await Promise.all([getProfile(), getMessages(), getNotionStatus()]);
  const t = m.settings;

  return (
    <>
      <PageHeader title={m.pages.settings.title} description={m.pages.settings.desc} />

      <div className="space-y-6">
        <Card id="profile">
          <CardHeader title={t.profile} />
          <SettingsProfileForm
            name={profile.name === "there" ? "" : profile.name}
            email={profile.email ?? ""}
            profession={profile.profession ?? ""}
            areas={profile.areas}
          />
        </Card>

        <Card id="data">
          <CardHeader title={t.dataTitle} />
          <div className="divide-y divide-border">
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm">{t.dataBody}</p>
                <p className="mt-1 text-[0.75rem] text-muted-foreground">{t.exportHint}</p>
              </div>
              <div className="flex gap-2">
                {(["md", "json"] as const).map((f) => (
                  <a
                    key={f}
                    href={`/api/brain/export?format=${f}`}
                    download
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
                  >
                    <Download className="h-3.5 w-3.5" /> {f === "md" ? t.exportMd : t.exportJson}
                  </a>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-medium">{t.redo}</p>
                <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{t.redoHint}</p>
              </div>
              <Link href="/onboarding" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}>
                <RotateCcw className="h-3.5 w-3.5" /> {t.redo}
              </Link>
            </div>

            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
              <div className="flex-1">
                <p className="text-sm font-medium text-danger">{t.deleteTitle}</p>
                <p className="mt-0.5 max-w-prose text-[0.75rem] leading-relaxed text-muted-foreground">{t.deleteBody}</p>
              </div>
              <DeleteData />
            </div>
          </div>
        </Card>

        <Card id="connections">
          <CardHeader title={t.connectionsTitle} />
          <ul className="divide-y divide-border">
            <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
                <Bot className="h-4 w-4" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium">{t.agentTitle}</p>
                <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{t.agentBody}</p>
              </div>
              <Link href="/agent" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}>
                {t.agentOpen} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>

            <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
                <NotebookPen className="h-4 w-4" />
              </span>
              <div className="flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  Notion
                  <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.62rem] font-normal uppercase tracking-wider text-muted-foreground">
                    {t.optional}
                  </span>
                </p>
                <p className="mt-0.5 max-w-prose text-[0.75rem] leading-relaxed text-muted-foreground">{t.notionBody}</p>
                {notion.connected && (
                  <Link
                    href="/generate"
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3 gap-1.5")}
                  >
                    <NotebookPen className="h-3.5 w-3.5" /> {t.notionBuild}
                  </Link>
                )}
              </div>
              {/* A real OAuth connection, with its own status and errors. */}
              <Suspense fallback={null}>
                <NotionConnect connected={notion.connected} workspaceName={notion.workspaceName} />
              </Suspense>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
