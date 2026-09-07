import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ArrowUpRight } from "lucide-react";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Analytics" };

const weeks = [52, 61, 48, 68, 64, 72, 68, 81];
const areas = [
  { name: "Projects", value: "68% on-track", bar: 68 },
  { name: "Finance", value: "+18% MRR", bar: 82 },
  { name: "Habits", value: "23-day streak", bar: 74 },
  { name: "Learning", value: "6 hrs this week", bar: 40 },
];

export default async function AnalyticsPage() {
  const m = await getMessages();
  return (
    <>
      <PageHeader title={m.pages.analytics.title} description={m.pages.analytics.desc} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Focus score", v: "72%", d: "+9%" },
          { l: "Tasks shipped", v: "48", d: "+14" },
          { l: "MRR", v: "$24.1k", d: "+18%" },
          { l: "Deep work", v: "11h", d: "+2h" },
        ].map((k) => (
          <Card key={k.l} className="p-4">
            <p className="text-[0.8125rem] text-muted-foreground">{k.l}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-medium tracking-tight">{k.v}</span>
              <span className="flex items-center text-[0.75rem] text-success">
                <ArrowUpRight className="h-3 w-3" />{k.d}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Weekly focus" />
          <div className="flex h-56 items-end gap-3 p-6">
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t-md bg-accent/70" style={{ height: `${w}%` }} />
                </div>
                <span className="text-[0.7rem] text-muted">W{i + 1}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="By area" />
          <div className="space-y-4 p-5">
            {areas.map((a) => (
              <div key={a.name}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span>{a.name}</span>
                  <span className="text-muted-foreground">{a.value}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${a.bar}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
