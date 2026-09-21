import type { Metadata } from "next";
import { Check, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { getMessages, getLocale } from "@/lib/i18n/server";
import { cn, formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

/**
 * Billing during early access.
 *
 * Payment is not wired yet, so this page says exactly that. It used to show
 * every user a "Pro · $49/mo" plan, a Visa ending 4242 and three paid invoices
 * — invented figures that could make someone believe they were being charged.
 * Nothing on this page may describe a charge, a card or an invoice until
 * Stripe checkout actually produces one.
 */
export default async function BillingPage() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);

  return (
    <>
      <PageHeader title={m.pages.billing.title} description={m.pages.billing.desc} />

      <Card className="p-5">
        <div className="flex items-start gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-success/30 bg-success/10 text-success">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] text-muted-foreground">{m.billing.accessTitle}</p>
            <p className="mt-1 text-xl font-medium tracking-tight">
              {m.billing.accessPlan}
              <span className="ml-2 text-base text-success">· {m.billing.accessPrice}</span>
            </p>
            <p className="mt-2 max-w-prose text-[0.875rem] leading-relaxed text-muted-foreground">
              {m.billing.accessBody}
            </p>
          </div>
        </div>
      </Card>

      <section className="mt-8">
        <h2 className="text-sm font-medium">{m.billing.plansTitle}</h2>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">{m.billing.plansNote}</p>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {m.pricing.plans.map((plan) => (
            <Card
              key={plan.id}
              className={cn("flex flex-col p-5", "featured" in plan && plan.featured && "border-accent/40")}
            >
              <p className="text-sm font-medium">{plan.name}</p>
              <p className="mt-0.5 text-[0.78rem] text-muted-foreground">{plan.tagline}</p>
              <p className="mt-3 text-2xl font-medium tracking-tight">
                {formatCurrency(plan.price, locale)}
                <span className="text-sm text-muted-foreground">{m.pricing.perMonth}</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-[0.8125rem]">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2 text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {f}
                  </li>
                ))}
              </ul>
              <p className="mt-5 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-center text-[0.75rem] text-muted-foreground">
                {m.billing.included}
              </p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
