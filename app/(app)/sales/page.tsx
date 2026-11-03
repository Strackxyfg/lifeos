import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { BusinessForm } from "@/components/sales/business-form";
import { CatalogPanel } from "@/components/sales/catalog-panel";
import { ClientsPanel } from "@/components/sales/clients-panel";
import { DocList } from "@/components/sales/doc-list";
import { money, SALES_TABS, type SalesTab } from "@/components/sales/format";
import { NewDocuments, SalesTabs } from "@/components/sales/sales-tabs";
import { getUserKey } from "@/lib/db/store";
import { fill, plural } from "@/lib/i18n/config";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { figuresOf, parisToday, rowsOf } from "@/lib/sales/overview";
import { getSalesStore } from "@/lib/sales/store";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.sales.title };
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [m, locale, sp] = await Promise.all([getMessages(), getLocale(), searchParams]);
  const t = m.sales;
  const tab: SalesTab = SALES_TABS.includes(sp.tab as SalesTab) ? (sp.tab as SalesTab) : "documents";
  const store = getSalesStore();

  if (!(await store.supports())) {
    return (
      <>
        <PageHeader title={t.title} description={t.desc} />
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-[0.875rem] leading-relaxed">{t.pending}</p>
      </>
    );
  }

  const userKey = await getUserKey();
  const [issuer, clients, catalog, docs] = await Promise.all([store.getIssuer(userKey), store.listClients(userKey), store.listCatalog(userKey), store.listDocs(userKey)]);
  const today = parisToday();
  const rows = rowsOf(docs, clients, today);
  const fig = figuresOf(rows, docs, today);
  // The years that have an issued invoice or credit note, newest first.
  const journalYears = [...new Set(docs.filter((d) => d.number !== null && d.kind !== "quote").map((d) => Number(d.content.issueDate.slice(0, 4))))].sort((a, b) => b - a);
  const docCounts: Record<string, number> = {};
  for (const d of docs) if (d.content.clientId) docCounts[d.content.clientId] = (docCounts[d.content.clientId] ?? 0) + 1;

  const kpis = [
    { label: t.kpi.outstanding, value: money(fig.outstanding.cents, locale), sub: plural(locale, fig.outstanding.count, t.kpi.invoices), tone: "" },
    { label: t.kpi.overdue, value: money(fig.overdue.cents, locale), sub: plural(locale, fig.overdue.count, t.kpi.invoices), tone: fig.overdue.count ? "text-danger" : "" },
    { label: fill(t.kpi.invoicedYear, { year: fig.invoicedYear.year }), value: money(fig.invoicedYear.netCents, locale), sub: t.kpi.invoicedHint, tone: "" },
    { label: t.kpi.quotesOpen, value: money(fig.quotesOpen.cents, locale), sub: plural(locale, fig.quotesOpen.count, t.kpi.quotes), tone: "" },
  ];

  return (
    <>
      <PageHeader title={t.title} description={t.desc} action={<NewDocuments />} />
      <SalesTabs active={tab} />

      {tab === "documents" && (
        <>
          {!issuer && (
            <Card className="mb-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-accent">
                <Building2 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-medium">{t.setup.title}</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{t.setup.body}</p>
              </div>
              <Link href="/sales?tab=business" className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
                {t.setup.cta}
              </Link>
            </Card>
          )}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => (
              <Card key={k.label} className="p-4">
                <p className="text-[0.8125rem] text-muted-foreground">{k.label}</p>
                <p className={cn("mt-1.5 text-xl font-medium tracking-tight tabular-nums sm:text-2xl", k.tone)}>{k.value}</p>
                <p className="mt-1 text-[0.72rem] text-muted">{k.sub}</p>
              </Card>
            ))}
          </div>
          <DocList rows={rows} />
          {journalYears.length > 0 && (
            <Card className="mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-medium">{t.journal.title}</p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">{t.journal.hint}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {journalYears.map((y) => (
                  <a key={y} href={`/api/sales/journal?year=${y}`} download className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    {fill(t.journal.download, { year: y })}
                  </a>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      {tab === "clients" && <ClientsPanel clients={clients} docCounts={docCounts} />}
      {tab === "catalog" && <CatalogPanel items={catalog} />}
      {tab === "business" && <BusinessForm issuer={issuer} />}
    </>
  );
}
