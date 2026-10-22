import type { Metadata } from "next";
import { Check, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { SwitchEdition } from "@/components/plans/switch-edition";
import { getMessages, getLocale } from "@/lib/i18n/server";
import { isEdition } from "@/lib/plans/editions";
import { getEditionState } from "@/lib/plans/server";
import { cn, formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

/**
 * Billing during early access: the edition in use, and the three to choose
 * from.
 *
 * Payment is not wired yet, so this page says exactly that. It used to show
 * every user a "Pro · $49/mo" plan, a Visa ending 4242 and three paid invoices
 * — invented figures that could make someone believe they were being charged.
 * Nothing on this page may describe a charge, a card or an invoice until
 * Stripe checkout actually produces one.
 */
export default async function BillingPage() {
  const [m, locale, state] = await Promise.all([getMessages(), getLocale(), getEditionState()]);
  const t = m.editions;

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
              {state.chosen ? t.names[state.chosen] : m.billing.accessPlan}
              <span className="ml-2 text-base text-success">· {m.billing.accessPrice}</span>
            </p>
            <p className="mt-2 max-w-prose text-[0.875rem] leading-relaxed text-muted-foreground">
              {state.chosen ? m.billing.accessBody : t.allOpen}
            </p>
          </div>
        </div>
      </Card>

      <section id="editions" className="mt-8 scroll-mt-24">
        <h2 className="text-sm font-medium">{m.billing.plansTitle}</h2>
        <p className="mt-1 max-w-prose text-[0.8125rem] text-muted-foreground">{m.billing.plansNote}</p>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {m.pricing.plans.map((plan) => {
            const edition = isEdition(plan.id) ? plan.id : null;
            const current = edition !== null && edition === state.chosen;
            const featured = "featured" in plan && plan.featured;
            return (
              <Card key={plan.id} className={cn("flex flex-col p-5", current ? "border-accent/60" : featured && "border-accent/30")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{plan.name}</p>
                  {current && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent">{t.chosen}</span>
                  )}
                </div>
                <p className="mt-0.5 text-[0.78rem] text-muted-foreground">{plan.tagline}</p>
                <p className="mt-3 text-2xl font-medium tracking-tight">
                  {plan.price === null ? (
                    <span className="text-base">{t.priceAtLaunch}</span>
                  ) : (
                    <>
                      {formatCurrency(plan.price, locale)}
                      <span className="text-sm text-muted-foreground">{m.pricing.perMonth}</span>
                    </>
                  )}
                </p>
                {plan.price === null && <p className="text-[0.75rem] text-muted-foreground">{t.perSeat}</p>}
                <p className="mt-1 text-[0.75rem] text-success">{m.pricing.earlyAccess}</p>
                <ul className="mt-4 flex-1 space-y-2 text-[0.8125rem]">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2 text-muted-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {f}
                    </li>
                  ))}
                </ul>
                {edition &&
                  (current ? (
                    <p className="mt-5 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-center text-[0.75rem] text-muted-foreground">
                      {m.billing.included}
                    </p>
                  ) : (
                    <SwitchEdition edition={edition} variant={featured ? "accent" : "secondary"} className="mt-5 w-full" />
                  ))}
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
