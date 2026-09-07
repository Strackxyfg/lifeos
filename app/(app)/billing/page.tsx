import type { Metadata } from "next";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { pricing } from "@/lib/content/site";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Billing" };

const invoices = [
  { date: "Jul 1, 2026", amount: "$49.00", status: "Paid" },
  { date: "Jun 1, 2026", amount: "$49.00", status: "Paid" },
  { date: "May 1, 2026", amount: "$49.00", status: "Paid" },
];

export default async function BillingPage() {
  const m = await getMessages();
  return (
    <>
      <PageHeader title={m.pages.billing.title} description={m.pages.billing.desc} />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.8125rem] text-muted-foreground">Current plan</p>
              <p className="mt-1 text-xl font-medium tracking-tight">Pro · $49/mo</p>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">Renews August 1, 2026</p>
            </div>
            <a href="#plans" className={buttonVariants({ variant: "secondary", size: "sm" })}>Change plan</a>
          </div>
          <div className="mt-6 space-y-4">
            {[
              { l: "Workspaces", used: 2, total: 3 },
              { l: "AI generations this month", used: 14, total: 50 },
            ].map((u) => (
              <div key={u.l}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span>{u.l}</span>
                  <span className="text-muted-foreground">{u.used} / {u.total}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(u.used / u.total) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Payment method" />
          <div className="p-5">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
              <span className="rounded bg-foreground px-2 py-1 text-[0.65rem] font-bold text-background">VISA</span>
              <span className="text-sm">•••• 4242</span>
              <span className="ml-auto text-[0.75rem] text-muted-foreground">12/27</span>
            </div>
            <p className="mt-3 text-[0.75rem] text-muted-foreground">Billing handled securely by Stripe.</p>
          </div>
        </Card>
      </div>

      <div id="plans" className="mt-8">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Plans</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {pricing.map((t) => (
            <Card key={t.id} className={cn("p-5", t.featured && "border-accent/40 shadow-glow")}>
              <p className="text-sm font-medium">{t.name}</p>
              <p className="mt-2 text-2xl font-medium tracking-tight">${t.price}<span className="text-sm text-muted-foreground">/mo</span></p>
              <ul className="mt-4 space-y-2 text-[0.8125rem]">
                {t.features.slice(0, 4).map((f) => (
                  <li key={f} className="flex gap-2 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-accent" /> {f}
                  </li>
                ))}
              </ul>
              <button className={cn(buttonVariants({ variant: t.featured ? "accent" : "secondary", size: "sm" }), "mt-5 w-full")}>
                {t.id === "pro" ? "Current plan" : `Switch to ${t.name}`}
              </button>
            </Card>
          ))}
        </div>
      </div>

      <Card className="mt-8">
        <CardHeader title="Invoices" />
        <div className="divide-y divide-border">
          {invoices.map((i) => (
            <div key={i.date} className="flex items-center px-5 py-3 text-sm">
              <span className="flex-1">{i.date}</span>
              <span className="w-24 text-muted-foreground">{i.amount}</span>
              <span className="flex items-center gap-1.5 text-[0.8125rem] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />{i.status}
              </span>
              <a href="#" className="ml-6 text-[0.8125rem] text-muted-foreground hover:text-foreground">Download</a>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
