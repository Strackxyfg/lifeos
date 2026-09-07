import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { ConnectNotionStep } from "@/components/onboarding/connect-notion-step";
import { getNotionStatus } from "@/lib/notion/connection";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Get started",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; notion?: string }>;
}) {
  const [{ step }, notion, locale, messages] = await Promise.all([
    searchParams,
    getNotionStatus(),
    getLocale(),
    getMessages(),
  ]);

  // Notion first: generation needs somewhere to build before we ask anything.
  // Already-connected users (or an env token) skip straight to the questions.
  const showConnect = !notion.connected && step !== "questions";

  return (
    <LocaleProvider locale={locale} messages={messages}>
      {showConnect ? (
        <div className="flex min-h-dvh flex-col">
          <header className="container flex max-w-content items-center justify-between py-6">
            <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              LifeOS
            </Link>
            <span className="font-mono text-[0.8125rem] text-muted-foreground">00 / 10</span>
          </header>
          <div className="container flex flex-1 items-center justify-center px-6 pb-20">
            <Suspense fallback={null}>
              <ConnectNotionStep connected={notion.connected} />
            </Suspense>
          </div>
        </div>
      ) : (
        <OnboardingWizard />
      )}
      <Toaster />
    </LocaleProvider>
  );
}
