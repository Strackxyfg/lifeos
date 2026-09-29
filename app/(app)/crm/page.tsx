import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { dealStages } from "@/lib/data/workspace";
import { loadWorkspace } from "@/lib/data/live";
import { getStore } from "@/lib/db/store";
import { DealNext } from "@/components/crm/deal-next";
import { QuickAdd } from "@/components/app/quick-add";
import { createDeal } from "@/app/actions/workspace";
import { formatCurrency, cn } from "@/lib/utils";
import { getMessages, getLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPage() {
  const [m, locale, data, founder] = await Promise.all([getMessages(), getLocale(), loadWorkspace(), getStore().supportsFounder()]);
  const { deals, reminders } = data;
  const open = deals.filter((d) => d.stage !== "Won" && d.stage !== "Lost");
  const openValue = open.reduce((s, d) => s + d.value, 0);
  const wonValue = deals.filter((d) => d.stage === "Won").reduce((s, d) => s + d.value, 0);
  // The open reminder each deal's next action has, if any.
  const reminderOf = new Map(reminders.filter((r) => r.dealId && !r.done).map((r) => [r.dealId as string, { dueAt: r.dueAt }]));

  // Deals keep no date of winning: the figure is all-time, and says so.
  const kpis = [
    { label: m.founder.crm.openPipeline, value: formatCurrency(openValue, locale) },
    { label: m.founder.crm.won, value: formatCurrency(wonValue, locale) },
    { label: m.founder.crm.openDeals, value: String(open.length) },
  ];

  return (
    <>
      <PageHeader
        title={m.pages.crm.title}
        description={m.pages.crm.desc}
        action={
          <QuickAdd
            triggerLabel={m.common.newDeal}
            title={m.common.newDeal}
            submitLabel={m.form.create}
            successMessage={m.form.savedDeal}
            action={createDeal}
            fields={[
              { name: "company", label: m.form.company, required: true, wide: true },
              { name: "name", label: m.form.dealName, wide: true },
              {
                name: "stage",
                label: m.form.stage,
                type: "select",
                defaultValue: "Lead",
                options: (["Lead", "Qualified", "Proposal", "Won", "Lost"] as const).map((v) => ({
                  value: v,
                  label: m.labels[v],
                })),
              },
              { name: "value", label: m.form.value, type: "number", defaultValue: "0" },
              { name: "owner", label: m.form.owner },
              { name: "next", label: m.form.nextStep },
            ]}
          />
        }
      />

      <div className="mb-3 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-[0.8125rem] text-muted-foreground">{k.label}</p>
            <p className="mt-1.5 text-2xl font-medium tracking-tight">{k.value}</p>
          </Card>
        ))}
      </div>

      {deals.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={m.empty.dealsTitle} description={m.empty.dealsDesc} />
        </Card>
      ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dealStages.map((stage) => {
          const items = deals.filter((d) => d.stage === stage);
          const total = items.reduce((s, d) => s + d.value, 0);
          return (
            <div key={stage} className="rounded-xl border border-border bg-surface/50 p-2.5">
              <div className="mb-2.5 flex items-center justify-between px-1.5">
                <span className="text-[0.8125rem] font-medium">{m.labels[stage]}</span>
                <span className="text-[0.72rem] text-muted">{formatCurrency(total, locale)}</span>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((d) => (
                  <div
                    key={d.id}
                    className={cn(
                      "cursor-default rounded-lg border border-border bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card",
                      stage === "Won" && "border-success/20"
                    )}
                  >
                    <p className="text-[0.875rem] font-medium">{d.company}</p>
                    <p className="text-[0.72rem] text-muted-foreground">{d.name}</p>
                    <p className="mt-2.5 font-mono text-[0.72rem] text-foreground/80">{formatCurrency(d.value, locale)}</p>
                    <DealNext id={d.id} next={d.next} nextAt={d.nextAt ?? null} reminder={reminderOf.get(d.id) ?? null} enabled={founder} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </>
  );
}
