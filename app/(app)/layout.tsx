import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { CommandMenu } from "@/components/command-menu";
import { Shortcuts } from "@/components/app/shortcuts";
import { Toaster } from "@/components/ui/toaster";
import { getProfile } from "@/lib/user/profile";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { buildAlerts } from "@/lib/data/alerts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, locale, messages] = await Promise.all([getProfile(), getLocale(), getMessages()]);
  const alerts = await buildAlerts(messages);

  return (
    <LocaleProvider locale={locale} messages={messages}>
      <div className="flex min-h-dvh">
        <Sidebar profile={profile} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar profile={profile} alerts={alerts} />
          <main className="flex-1 px-4 py-8 lg:px-8 lg:py-10">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
        <CommandMenu />
        <Shortcuts />
        <Toaster />
      </div>
    </LocaleProvider>
  );
}
