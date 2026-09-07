import type { Metadata } from "next";
import { ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/table";
import { financeSummary } from "@/lib/data/workspace";
import { loadCollection } from "@/lib/data/live";
import { QuickAdd } from "@/components/app/quick-add";
import { createTransaction } from "@/app/actions/workspace";
import { formatCurrency, cn } from "@/lib/utils";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage() {
  const [m, transactions] = await Promise.all([getMessages(), loadCollection("transactions")]);
  const { income, expense, net } = financeSummary(transactions);

  // Category breakdown of expenses.
  const byCategory = transactions
    .filter((t) => t.type === "Expense")
    .reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount;
      return acc;
    }, {});
  const maxCat = Math.max(...Object.values(byCategory), 1);

  return (
    <>
      <PageHeader
        title={m.pages.finance.title}
        description={m.pages.finance.desc}
        action={
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
              { name: "date", label: m.form.date, placeholder: "Jul 26" },
            ]}
          />
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
              <span className="text-2xl font-medium tracking-tight">{formatCurrency(k.v)}</span>
              <span className={cn("flex items-center text-[0.72rem]", k.up ? "text-success" : "text-warning")}>
                {k.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {transactions.length === 0 ? (
            <Card>
              <EmptyState
                icon={Wallet}
                title={m.empty.financeTitle}
                description={m.empty.financeDesc}
              />
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
                  <Td className="text-muted-foreground">{t.date}</Td>
                  <Td className={cn("text-right font-mono", t.type === "Income" ? "text-success" : "text-foreground/80")}>
                    {t.type === "Income" ? "+" : "−"}{formatCurrency(t.amount)}
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
                  <span className="font-mono text-muted-foreground">{formatCurrency(amt)}</span>
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
