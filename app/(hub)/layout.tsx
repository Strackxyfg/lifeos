import { CommandMenu } from "@/components/command-menu";
import { Shortcuts } from "@/components/app/shortcuts";
import { Toaster } from "@/components/ui/toaster";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { loadReminders } from "@/lib/data/live";
import { upcomingReminders } from "@/lib/reminders/client";
import { ReminderWatcher } from "@/components/reminders/reminder-watcher";

/**
 * The hub is the whole screen: no sidebar, no top bar — the island is the
 * navigation, with its own heads-up display. The command menu, the shortcuts
 * and the toasts work here exactly as everywhere else.
 */
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, { reminders }] = await Promise.all([getLocale(), getMessages(), loadReminders()]);
  return (
    <LocaleProvider locale={locale} messages={messages}>
      <main>{children}</main>
      <CommandMenu />
      <Shortcuts />
      <Toaster />
      <ReminderWatcher initial={upcomingReminders(reminders, new Date())} />
    </LocaleProvider>
  );
}
