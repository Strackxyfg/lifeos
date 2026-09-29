import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Brain, Map as MapIcon, Scale, Sparkles, Target } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { TodayTasks } from "@/components/app/today-tasks";
import { AiInsights } from "@/components/app/ai-insights";
import { RemindersPanel } from "@/components/reminders/reminders-panel";
import { CaptureChart } from "@/components/dashboard/capture-chart";
import { computeSnapshot, statusColor } from "@/lib/data/workspace";
import { loadReminders, loadWorkspace } from "@/lib/data/live";
import { ReviewNudge } from "@/components/review/review-nudge";
import { loadBrainView } from "@/lib/brain/load";
import { brainDigest } from "@/lib/brain/digest";
import { computeFocus } from "@/lib/brain/focus";
import { openTensions } from "@/lib/brain/graph";
import { focusReasonText } from "@/lib/brain/labels";
import { openReminders, reminderCounts } from "@/lib/reminders/client";
import { getStore } from "@/lib/db/store";
import { cn, formatCurrency } from "@/lib/utils";
import { getProfile } from "@/lib/user/profile";
import { getMessages, getLocale } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(m: Messages): string {
  const h = new Date().getHours();
  if (h < 12) return m.dashboard.morning;
  if (h < 18) return m.dashboard.afternoon;
  return m.dashboard.evening;
}

const FOURTEEN_DAYS = 14 * 86_400_000;

/**
 * The dashboard: no longer the home (the island is), a place of its own — the
 * day in one screen. Reminders first, because they are about time; then what
 * the brain says deserves attention; then the figures, all read from the
 * person's own data.
 */
export default async function DashboardPage() {
  const now = new Date();
  const [{ firstName }, m, locale, data, view, memory, { reminders, available }] = await Promise.all([
    getProfile(),
    getMessages(),
    getLocale(),
    loadWorkspace(),
    getMessages().then((mm) => loadBrainView(mm)),
    getStore().supportsMemory(),
    loadReminders(),
  ]);
  const d = m.dashboard;

  const snapshot = computeSnapshot(data);
  const activeProjects = data.projects.filter((p) => p.status !== "Done");
  const digest = brainDigest({ notes: view.notes, links: view.links, now, memory });
  const focus = computeFocus({ notes: view.notes, links: view.links, now, limit: 3 });
  const titles = new Map(view.notes.map((n) => [n.id, n.title]));
  const tensions = openTensions(view.links).length;
  const counts = reminderCounts(reminders, now);
  const recent = view.notes.filter((n) => now.getTime() - Date.parse(n.createdAt) < FOURTEEN_DAYS + 86_400_000).map((n) => n.createdAt);

  const subline = [
    available && counts.today + counts.overdue > 0 ? plural(locale, counts.today + counts.overdue, d.subtitleReminders) : null,
    plural(locale, snapshot.tasks.open, d.sublineTasks),
    plural(locale, view.notes.length, d.sublineNotes),
  ].filter(Boolean);

  const kpis = [
    { key: "kpiNotes", value: new Intl.NumberFormat(locale).format(view.notes.length) },
    { key: "kpiLinks", value: new Intl.NumberFormat(locale).format(view.links.length) },
    { key: "kpiTasks", value: new Intl.NumberFormat(locale).format(snapshot.tasks.open) },
    { key: "kpiActiveProjects", value: String(activeProjects.length), sub: `${snapshot.projects.avgProgress}%` },
    { key: "kpiPipeline", value: formatCurrency(snapshot.crm.openValue, locale) },
    { key: "kpiNet", value: formatCurrency(snapshot.finance.net, locale), negative: snapshot.finance.net < 0 },
  ] as const;

  return (
    <>
      <PageHeader
        title={`${greeting(m)}, ${firstName}`}
        description={subline.join(" · ")}
        action={
          <Link
            href="/hub"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
          >
            <MapIcon className="h-3.5 w-3.5" aria-hidden />
            {d.backToHub}
          </Link>
        }
      />

      <ReviewNudge reviewedWeeks={data.reviews.map((r) => r.weekStart)} />

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Reminders — the day's promises. */}
        <div className="lg:col-span-2">
          <RemindersPanel
            initial={openReminders(reminders)}
            available={available}
            notes={Object.fromEntries(reminders.filter((r) => r.noteId && titles.has(r.noteId)).map((r) => [r.noteId!, titles.get(r.noteId!)!]))}
          />
        </div>

        {/* What the brain says deserves attention. */}
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-accent" aria-hidden />
                  {d.focus}
                </span>
              }
              action={
                <Link href="/brain" className="flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground">
                  {d.openBrain} <ArrowRight className="h-3 w-3" />
                </Link>
              }
            />
            {focus.length === 0 ? (
              <p className="px-5 py-5 text-sm text-muted-foreground">{d.focusEmpty}</p>
            ) : (
              <ol className="divide-y divide-border">
                {focus.map((f, i) => (
                  <li key={f.id}>
                    <Link href={`/brain?note=${f.id}`} className="flex gap-3 px-5 py-3 transition-colors hover:bg-surface-2/40">
                      <span className="mt-0.5 font-mono text-[0.75rem] text-muted">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{titles.get(f.id)}</span>
                        <span className="block text-[0.75rem] text-muted-foreground">{focusReasonText(f.reason, m, locale)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-4">
            <ul className="space-y-2 text-sm">
              <AttentionLine icon={Brain} n={digest.dueForReview} text={plural(locale, digest.dueForReview, d.toReview)} href="/brain" />
              <AttentionLine icon={Scale} n={tensions} text={plural(locale, tensions, d.toDecide)} href="/brain" />
              <AttentionLine icon={Sparkles} n={digest.awaitingReview} text={plural(locale, digest.awaitingReview, d.toCheck)} href="/brain" />
            </ul>
          </Card>
        </div>
      </div>

      {/* The figures, from the person's own rows. */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.key} className="p-4">
            <p className="truncate text-[0.8125rem] text-muted-foreground">{d[k.key]}</p>
            <p className={cn("mt-2 text-2xl font-medium tracking-tight", "negative" in k && k.negative && "text-danger")}>
              {k.value}
              {"sub" in k && k.sub && <span className="ml-1.5 text-sm font-normal text-muted-foreground">· {k.sub}</span>}
            </p>
          </Card>
        ))}
      </div>

      {/* Each card its own height: the tallest (the briefing) does not stretch the others. */}
      <div className="mt-3 grid items-start gap-3 lg:grid-cols-3">
        <Card>
          <CaptureChart createdAt={recent} />
          <div className="border-t border-border px-5 py-3 text-[0.8125rem] text-muted-foreground">
            <span className="font-medium text-foreground">{d.week}</span> · {plural(locale, digest.capturedThisWeek, d.capturedWeek)} ·{" "}
            {plural(locale, digest.connectedThisWeek, d.connectedWeek)}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={d.projects}
            action={
              <Link href="/projects" className="flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground">
                {d.viewAll} <ArrowRight className="h-3 w-3" />
              </Link>
            }
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
                <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem]", statusColor[p.status])}>{m.labels[p.status]}</span>
              </div>
            ))}
            {activeProjects.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">{m.common.nothingHere}</p>}
          </div>
        </Card>

        {/* AI insights — weekly review + daily summary. */}
        <AiInsights />
      </div>

      <div className="mt-3">
        <TodayTasks
          initial={data.tasks.map((t) => ({
            id: t.id,
            t: t.labelKey ? d.tasks[t.labelKey as keyof typeof d.tasks] : (t.label ?? ""),
            done: t.done,
          }))}
        />
      </div>
    </>
  );
}

function AttentionLine({ icon: Icon, n, text, href }: { icon: typeof Brain; n: number; text: string; href: string }) {
  return (
    <li>
      <Link href={href} className={cn("flex items-center gap-2.5 rounded-md py-1 transition-colors hover:text-foreground", n > 0 ? "text-foreground" : "text-muted-foreground")}>
        <Icon className={cn("h-4 w-4", n > 0 ? "text-accent" : "text-muted")} aria-hidden />
        <span className="flex-1">{text}</span>
        {n > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />}
      </Link>
    </li>
  );
}
