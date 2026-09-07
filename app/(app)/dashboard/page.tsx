import type { Metadata } from "next";
import { ArrowRight, CalendarDays, Mail, MessageSquare, Github } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { TodayTasks } from "@/components/app/today-tasks";
import { AiInsights } from "@/components/app/ai-insights";
import { computeSnapshot, statusColor } from "@/lib/data/workspace";
import { loadWorkspace } from "@/lib/data/live";
import { cn, formatCurrency } from "@/lib/utils";
import { getProfile } from "@/lib/user/profile";
import { getMessages } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(m: Messages): string {
  const h = new Date().getHours();
  if (h < 12) return m.dashboard.morning;
  if (h < 18) return m.dashboard.afternoon;
  return m.dashboard.evening;
}

const integrations = [
  { name: "Google Calendar", icon: CalendarDays, ok: true },
  { name: "Gmail", icon: Mail, ok: true },
  { name: "Slack", icon: MessageSquare, ok: true },
  { name: "GitHub", icon: Github, ok: false },
];


export default async function DashboardPage() {
  const [{ firstName }, m, data] = await Promise.all([
    getProfile(),
    getMessages(),
    loadWorkspace(),
  ]);

  const snapshot = computeSnapshot(data);
  const activeProjects = data.projects.filter((p) => p.status !== "Done");

  // KPIs derived from persisted rows, not hardcoded.
  const kpis = [
    { key: "kpiActiveProjects", value: String(activeProjects.length) },
    { key: "kpiWeeklyFocus", value: `${snapshot.projects.avgProgress}%` },
    { key: "kpiMrr", value: formatCurrency(snapshot.finance.income) },
    { key: "kpiHabitStreak", value: `${snapshot.habitStreak}d` },
  ] as const;

  return (
    <>
      <PageHeader
        title={`${greeting(m)}, ${firstName}`}
        description={fill(m.dashboard.subline, {
          open: snapshot.tasks.open,
          streak: snapshot.habitStreak,
        })}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.key} className="p-4">
            <p className="text-[0.8125rem] text-muted-foreground">{m.dashboard[k.key]}</p>
            <p className="mt-2 text-2xl font-medium tracking-tight">{k.value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {/* Projects */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={m.dashboard.projects}
            action={<a href="/projects" className="flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground">{m.dashboard.viewAll} <ArrowRight className="h-3 w-3" /></a>}
          />
          <div className="divide-y divide-border">
            {activeProjects.slice(0, 4).map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <div className="mt-1.5 h-1 w-40 max-w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${p.progress}%` }} />
                  </div>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem]", statusColor[p.status])}>
                  {m.labels[p.status]}
                </span>
                <span className="w-14 text-right text-[0.8125rem] text-muted-foreground">{p.due}</span>
              </div>
            ))}
            {activeProjects.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">{m.common.nothingHere}</p>
            )}
          </div>
        </Card>

        {/* AI insights — weekly review + daily summary */}
        <AiInsights />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {/* Today */}
        <div className="lg:col-span-2">
          <TodayTasks
            initial={data.tasks.map((t) => ({
              id: t.id,
              t: t.labelKey
                ? m.dashboard.tasks[t.labelKey as keyof typeof m.dashboard.tasks]
                : (t.label ?? ""),
              done: t.done,
            }))}
          />
        </div>

        {/* Integrations */}
        <Card>
          <CardHeader title={m.dashboard.integrations} />
          <ul className="divide-y divide-border">
            {integrations.map((i) => (
              <li key={i.name} className="flex items-center gap-3 px-5 py-3">
                <i.icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm">{i.name}</span>
                <span className={cn("flex items-center gap-1.5 text-[0.75rem]", i.ok ? "text-success" : "text-muted-foreground")}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", i.ok ? "bg-success" : "bg-border-strong")} />
                  {i.ok ? m.common.connected : m.common.connect}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
