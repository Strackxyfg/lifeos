import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { loadWorkspace } from "@/lib/data/live";
import { getStore } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";
import { InvestorReportView } from "@/components/report/investor-report";
import type { ReportInput } from "@/lib/report/investor";

export const metadata: Metadata = { title: "Investor update" };

export default async function InvestorReportPage() {
  const [m, data, founder] = await Promise.all([getMessages(), loadWorkspace(), getStore().supportsFounder()]);
  const input: ReportInput = {
    transactions: data.transactions.map((t) => ({ id: t.id, item: t.item, type: t.type, amount: Number(t.amount), occurredOn: t.occurredOn ?? null })),
    balances: data.balances.map((b) => ({ id: b.id, amount: Number(b.amount), asOf: b.asOf })),
    deals: data.deals.map((d) => ({ id: d.id, name: d.name, company: d.company, stage: d.stage, value: Number(d.value) })),
    projects: data.projects.map((p) => ({ id: p.id, name: p.name, status: p.status, progress: p.progress })),
    reviews: data.reviews.map((r) => ({ weekStart: r.weekStart, wins: r.wins, blockers: r.blockers, decisions: (r.decisions ?? []).map((d) => ({ text: d.text, why: d.why })) })),
  };
  return (
    <>
      <PageHeader title={m.founder.report.title} description={m.founder.report.subtitle} />
      {!founder && <Card className="mb-3 p-4 text-[0.8125rem] text-muted-foreground">{m.founder.migration}</Card>}
      <InvestorReportView input={input} />
    </>
  );
}
