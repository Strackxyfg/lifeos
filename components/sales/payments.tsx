"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { balanceOf, paidOf, parseEuros } from "@/lib/sales/compute";
import { PAYMENT_METHODS, type SalesDoc } from "@/lib/sales/model";
import { recordPayment, removePayment } from "@/app/actions/sales";
import { eurosOf, Field, inputCls } from "./fields";
import { attempt, day, failureText, money } from "./format";

/** What was received on an invoice, what is still owed, and a payment to add. */
export function Payments({ doc, today }: { doc: SalesDoc; today: string }) {
  const t = useMessages().sales;
  const p = t.doc;
  const locale = useLocale();
  const router = useRouter();
  const balance = balanceOf(doc.totals, doc.payments);
  const open = doc.state !== "cancelled" && balance > 0;
  const [form, setForm] = useState<{ amount: string; date: string; method: (typeof PAYMENT_METHODS)[number] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const cents = parseEuros(form.amount);
    if (cents === null || cents <= 0) return setError(t.fieldErrors.unitPrice);
    if (cents > balance) return setError(t.errors.too_much);
    setBusy("add");
    setError(null);
    const r = await attempt(() => recordPayment(doc.id, { date: form.date, amountCents: cents, method: form.method }));
    setBusy(null);
    if (!r.ok) return setError(failureText(t, r));
    setForm(null);
    toast(p.paymentSaved);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(id);
    const r = await attempt(() => removePayment(doc.id, id));
    setBusy(null);
    if (!r.ok) return toast(failureText(t, r), "error");
    toast(p.paymentRemoved);
    router.refresh();
  };

  return (
    <Card className="p-4">
      <h2 className="text-[0.875rem] font-semibold">{p.payments}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-[0.8125rem]">
        <div>
          <dt className="text-muted-foreground">{p.paid}</dt>
          <dd className="font-medium tabular-nums">{money(paidOf(doc.payments), locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{p.balance}</dt>
          <dd className={cn("font-medium tabular-nums", balance > 0 && doc.state !== "cancelled" && "text-warning")}>{money(doc.state === "cancelled" ? 0 : balance, locale)}</dd>
        </div>
      </dl>

      {doc.payments.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-muted">{p.noPayment}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-y border-border text-[0.8125rem]">
          {doc.payments.map((x) => (
            <li key={x.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="tabular-nums">{money(x.amountCents, locale)}</span>
                <span className="block text-[0.72rem] text-muted-foreground">
                  {day(x.date, locale)} · {p.methods[x.method]}
                </span>
              </span>
              <button type="button" disabled={busy !== null} onClick={() => remove(x.id)} aria-label={`${p.remove} — ${money(x.amountCents, locale)}`} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "hover:text-danger")}>
                {busy === x.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open &&
        (form ? (
          <form onSubmit={submit} className="mt-3 grid gap-2" noValidate>
            <Field label={p.amount} error={error}>
              {(f) => <input {...f} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={cn(inputCls, "tabular-nums")} data-autofocus />}
            </Field>
            <Field label={p.date}>{(f) => <input {...f} type="date" value={form.date} max={today} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />}</Field>
            <Field label={p.method}>
              {(f) => (
                <select {...f} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as (typeof PAYMENT_METHODS)[number] })} className={inputCls}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {p.methods[m]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                {t.cancel}
              </button>
              <button type="submit" disabled={busy !== null} className={buttonVariants({ size: "sm" })}>
                {busy === "add" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {t.save}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setForm({ amount: eurosOf(balance, locale), date: today, method: "transfer" })} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3 w-full")}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {p.record}
          </button>
        ))}
      <p className="mt-3 text-[0.72rem] leading-relaxed text-muted">{p.financeNote}</p>
    </Card>
  );
}
