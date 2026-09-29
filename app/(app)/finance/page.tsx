import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, FileText, Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/table";
import { financeSummary } from "@/lib/data/workspace";
import { loadWorkspace } from "@/lib/data/live";
import { getStore } from "@/lib/db/store";
import { QuickAdd } from "@/components/app/quick-add";
import { createTransaction } from "@/app/actions/workspace";
import { BalancePanel, DateAssistant, TreasuryPanel, type FinanceTxn } from "@/components/finance/treasury";
import { formatCurrency, cn } from "@/lib/utils";
import { getMessages, getLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage() {
  const [m, locale, data, founder] = await Promise.all([getMessages(), getLocale(), loadWorkspace(), getStore().supportsFounder()]);
  const { transactions, balances } = data;
  const { income, expense, net } = financeSummary(transactions);

  // Category breakdown of expenses.
  const byCategory = transactions
    .filter((t) => t.type === "Expense")
    .reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount;
      return acc;
    }, {});
  const maxCat = Math.max(...Object.values(byCategory), 1);

  const txns: FinanceTxn[] = transactions.map((t) => ({
    id: t.id,
    item: t.item,
    type: t.type,
    amount: Number(t.amount),
    date: t.date,
    occurredOn: t.occurredOn ?? null,
    createdAt: t.createdAt,
  }));
  const shownDate = (t: (typeof transactions)[number]) =>
    t.occurredOn
      ? new Date(`${t.occurredOn}T12:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
      : t.date;

  return (
    <>
      <PageHeader
        title={m.pages.finance.title}
        description={m.pages.finance.desc}
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/reports/investor"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              <FileText className="h-4 w-4" aria-hidden />
              {m.founder.report.nav}
            </Link>
            <QuickAdd
              triggerLabel={m.common.addEntry}
              title={m.common.addEntry}
              submitLabel={m.form.create}
              successMessage={m.form.savedEntry}
              action={createTransaction}
              fields={[
                { name: "item", label: m.form.description, required: true, wide: true },
                {
                  name: "type",
                  label: m.form.type,
                  type: "select",
                  defaultValue: "Expense",
                  options: (["Income", "Expense"] as const).map((v) => ({ value: v, label: m.labels[v] })),
                },
                { name: "amount", label: m.form.amount, type: "number", required: true },
                { name: "category", label: m.form.category, defaultValue: "Other" },
                // A real day: the treasury counts it.
                { name: "date", label: m.form.date, type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
              ]}
            />
          </div>
        }
      />

      <div className="mb-3 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        {[
          { l: m.labels.Income, v: income, up: true },
          { l: m.labels.Expense, v: expense, up: false },
          { l: "Net", v: net, up: net >= 0 },
        ].map((k) => (
          <Card key={k.l} className="p-4">
            <p className="text-[0.8125rem] text-muted-foreground">{k.l}</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-medium tracking-tight">{formatCurrency(k.v, locale)}</span>
              <span className={cn("flex items-center text-[0.72rem]", k.up ? "text-success" : "text-warning")}>
                {k.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {founder ? (
        <div className="mb-3 grid gap-3 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <TreasuryPanel txns={txns} balances={balances.map((b) => ({ id: b.id, amount: Number(b.amount), asOf: b.asOf, note: b.note }))} />
            {transactions.length > 0 && <DateAssistant txns={txns} />}
          </div>
          <BalancePanel balances={balances.map((b) => ({ id: b.id, amount: Number(b.amount), asOf: b.asOf, note: b.note }))} />
        </div>
      ) : (
        <Card className="mb-3 p-4 text-[0.8125rem] text-muted-foreground">{m.founder.migration}</Card>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {transactions.length === 0 ? (
            <Card>
              <EmptyState icon={Wallet} title={m.empty.financeTitle} description={m.empty.financeDesc} />
            </Card>
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th className="w-2/5">Item</Th>
                  <Th>Category</Th>
                  <Th>Date</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </Thead>
              <tbody>
                {transactions.map((t) => (
                  <Tr key={t.id}>
                    <Td className="font-medium">{t.item}</Td>
                    <Td className="text-muted-foreground">{t.category}</Td>
                    <Td className={cn("text-muted-foreground", founder && !t.occurredOn && "italic text-warning/80")}>{shownDate(t)}</Td>
                    <Td className={cn("text-right font-mono", t.type === "Income" ? "text-success" : "text-foreground/80")}>
                      {t.type === "Income" ? "+" : "−"}
                      {formatCurrency(t.amount, locale)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        <Card>
          <CardHeader title="Expenses by category" />
          <div className="space-y-4 p-5">
            {Object.entries(byCategory).map(([cat, amt]) => (
              <div key={cat}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span>{cat}</span>
                  <span className="font-mono text-muted-foreground">{formatCurrency(amt, locale)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(amt / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
