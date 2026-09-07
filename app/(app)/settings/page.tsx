import type { Metadata } from "next";
import {
  CalendarDays, Mail, MessageSquare, Github, CreditCard, NotebookPen,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Suspense } from "react";
import { PreferenceSwitch } from "@/components/app/preference-switch";
import { NotionConnect } from "@/components/app/notion-connect";
import { getNotionStatus } from "@/lib/notion/connection";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getProfile } from "@/lib/user/profile";
import { getPreferences, type PreferenceKey } from "@/lib/user/preferences";
import { getMessages } from "@/lib/i18n/server";
import { SettingsProfileForm } from "@/components/app/settings-profile-form";

export const metadata: Metadata = { title: "Settings" };

const integrations: { key: PreferenceKey; name: string; icon: typeof NotebookPen }[] = [
  { key: "notion", name: "Notion", icon: NotebookPen },
  { key: "google", name: "Google Calendar", icon: CalendarDays },
  { key: "gmail", name: "Gmail", icon: Mail },
  { key: "slack", name: "Slack", icon: MessageSquare },
  { key: "github", name: "GitHub", icon: Github },
  { key: "stripe", name: "Stripe", icon: CreditCard },
];

const notifications: { key: PreferenceKey; l: string; d: string }[] = [
  { key: "weeklyReview", l: "Weekly AI review", d: "Sunday evening summary of your week" },
  { key: "dailySummary", l: "Daily summary", d: "A morning briefing at 8:00am" },
  { key: "atRiskAlerts", l: "At-risk alerts", d: "When a project is likely to slip" },
];

export default async function SettingsPage() {
  const [profile, m, prefs, notion] = await Promise.all([
    getProfile(),
    getMessages(),
    getPreferences(),
    getNotionStatus(),
  ]);
  return (
    <>
      <PageHeader title={m.pages.settings.title} description={m.pages.settings.desc} />

      <div className="space-y-6">
        {/* Profile */}
        <Card>
          <CardHeader title="Profile" />
          <SettingsProfileForm
            name={profile.name === "there" ? "" : profile.name}
            email={profile.email ?? ""}
            profession={profile.profession ?? "Founder / Operator"}
          />
        </Card>

        {/* Integrations */}
        <Card>
          <CardHeader title="Integrations" />
          <ul className="divide-y divide-border">
            {integrations.map((i) => (
              <li key={i.name} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
                  <i.icon className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{i.name}</p>
                  <p className="text-[0.75rem] text-muted-foreground">
                    {i.key === "notion" && notion.connected
                      ? m.common.connected
                      : prefs[i.key]
                        ? m.common.connected
                        : m.common.connect}
                  </p>
                </div>
                {/* Notion is a real OAuth connection, not a local preference. */}
                {i.key === "notion" ? (
                  <Suspense fallback={null}>
                    <NotionConnect connected={notion.connected} workspaceName={notion.workspaceName} />
                  </Suspense>
                ) : (
                  <PreferenceSwitch prefKey={i.key} defaultChecked={prefs[i.key]} label={`Toggle ${i.name}`} />
                )}
              </li>
            ))}
          </ul>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader title="Automations & notifications" />
          <ul className="divide-y divide-border">
            {notifications.map((n) => (
              <li key={n.l} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex-1">
                  <p className="text-sm font-medium">{n.l}</p>
                  <p className="text-[0.75rem] text-muted-foreground">{n.d}</p>
                </div>
                <PreferenceSwitch prefKey={n.key} defaultChecked={prefs[n.key]} label={n.l} />
              </li>
            ))}
          </ul>
        </Card>

        {/* Danger zone */}
        <Card className="border-danger/20">
          <CardHeader title={<span className="text-danger">Danger zone</span>} />
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm font-medium">Delete workspace</p>
              <p className="text-[0.75rem] text-muted-foreground">Removes LifeOS data. Your Notion pages stay yours.</p>
            </div>
            <button className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "border-danger/30 text-danger hover:bg-danger/10")}>
              Delete
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
