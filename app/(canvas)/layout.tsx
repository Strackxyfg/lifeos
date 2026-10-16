import { CommandMenu } from "@/components/command-menu";
import { Shortcuts } from "@/components/app/shortcuts";
import { Toaster } from "@/components/ui/toaster";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { loadReminders } from "@/lib/data/live";
import { upcomingReminders } from "@/lib/reminders/client";
import { ReminderWatcher } from "@/components/reminders/reminder-watcher";

/**
 * Pages that are a whole screen of work — a mind map open — with no sidebar
 * or top bar of the app around them; their own tools take that place. The
 * command menu, the shortcuts, the toasts and the reminders work as
 * everywhere else.
 */
export default async function CanvasLayout({ children }: { children: React.ReactNode }) {
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
