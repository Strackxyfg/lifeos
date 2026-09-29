"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronDown, Landmark, Loader2, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { treasury, type BalanceLike } from "@/lib/finance/treasury";
import { proposeDate } from "@/lib/finance/dates";
import { deleteBalance, saveBalance, setTransactionDates, type FounderErrorCode } from "@/app/actions/founder";

export interface FinanceTxn {
  id: string;
  item: string;
  type: "Income" | "Expense";
  amount: number;
  date: string;
  occurredOn: string | null;
  createdAt: string;
}

export interface FinanceBalance extends BalanceLike {
  note: string | null;
}

/** Today in the person's own calendar (YYYY-MM-DD). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Money to the cent: a treasury is not a dashboard's rounded headline. */
export function money(n: number, locale: string, currency = "USD"): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);
}

export function day(iso: string, locale: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthName(ym: string, locale: string): string {
  return new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function errorText(m: ReturnType<typeof useMessages>, code: FounderErrorCode) {
  return m.founder.errors[code];
}

/**
 * Cash, burn and runway, each with where it comes from; the dated months
 * behind the burn; and what is not counted (undated or future
 * transactions), said plainly.
 */
export function TreasuryPanel({ txns, balances }: { txns: FinanceTxn[]; balances: FinanceBalance[] }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.founder.treasury;
  const today = localToday();
  const tr = useMemo(() => treasury(txns, balances, today), [txns, balances, today]);
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(txns.map((x) => [x.id, x])), [txns]);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Landmark className="h-4 w-4 text-accent" aria-hidden />
            {t.title}
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t.subtitle}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-[0.75rem] text-muted-foreground">{t.cash}</p>
          {tr.cash !== null && tr.anchor ? (
            <>
              <p className="mt-1 text-xl font-medium tracking-tight">{money(tr.cash, locale)}</p>
              <p className="mt-1 text-[0.72rem] leading-relaxed text-muted">
                {fill(t.anchor, { amount: money(tr.anchor.amount, locale), date: day(tr.anchor.asOf, locale) })}
                {" · "}
                {plural(locale, tr.sinceAnchor.ids.length, t.since, { net: money(tr.sinceAnchor.net, locale) })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{t.noAnchor}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-[0.75rem] text-muted-foreground">{t.burn}</p>
          {tr.burn ? (
            <>
              <p className={cn("mt-1 flex items-center gap-1.5 text-xl font-medium tracking-tight", tr.burn.averageNet < 0 ? "text-warning" : "text-success")}>
                {tr.burn.averageNet < 0 ? <TrendingDown className="h-4 w-4" aria-hidden /> : <TrendingUp className="h-4 w-4" aria-hidden />}
                {money(tr.burn.averageNet, locale)}
              </p>
              <p className="mt-1 text-[0.72rem] text-muted">{plural(locale, tr.burn.months.length, t.burnOver)}</p>
            </>
          ) : (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{t.burnNone}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-[0.75rem] text-muted-foreground">{t.runway}</p>
          {tr.runway === "growing" ? (
            <p className="mt-1 text-[0.9375rem] font-medium text-success">{t.growing}</p>
          ) : tr.runway ? (
            <p className="mt-1 text-xl font-medium tracking-tight">
              {fill(t.runwayMonths, { n: tr.runway.months.toLocaleString(locale === "fr" ? "fr-FR" : "en-US"), month: monthName(tr.runway.endsIn, locale) })}
            </p>
          ) : (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{t.runwayNone}</p>
          )}
        </div>
      </div>

      {(tr.undated > 0 || tr.future > 0) && (
        <ul className="mt-3 space-y-1 text-[0.8125rem] text-warning">
          {tr.undated > 0 && <li>{plural(locale, tr.undated, t.undated)}</li>}
          {tr.future > 0 && <li>{plural(locale, tr.future, t.future)}</li>}
        </ul>
      )}

      {tr.burn && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            {m.founder.report.sources}
          </button>
          {open && (
            <table className="mt-2 w-full text-[0.8125rem]">
              <thead>
                <tr className="text-left text-[0.72rem] text-muted">
                  <th className="py-1 font-normal">{t.month}</th>
                  <th className="py-1 text-right font-normal">{t.income}</th>
                  <th className="py-1 text-right font-normal">{t.expense}</th>
                  <th className="py-1 text-right font-normal">{t.net}</th>
                </tr>
              </thead>
              <tbody>
                {tr.burn.months.map((mo) => (
                  <tr key={mo.month} className="border-t border-border align-top">
                    <td className="py-1.5">
                      <span className="capitalize">{monthName(mo.month, locale)}</span>
                      <span className="block text-[0.72rem] text-muted">
                        {mo.ids
                          .map((id) => byId.get(id)?.item)
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono">{money(mo.income, locale)}</td>
                    <td className="py-1.5 text-right font-mono">{money(mo.expense, locale)}</td>
                    <td className={cn("py-1.5 text-right font-mono", mo.net < 0 ? "text-warning" : "text-success")}>{money(mo.net, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}

/** States the cash on a day, and lists what was stated before. */
export function BalancePanel({ balances }: { balances: FinanceBalance[] }) {
  const m = useMessages();
  const locale = useLocale();
  const b = m.founder.balance;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [asOf, setAsOf] = useState(localToday());
  const [note, setNote] = useState("");
  const sorted = [...balances].sort((x, y) => (x.asOf < y.asOf ? 1 : -1));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await saveBalance({ amount: Number(amount.replace(",", ".").replace(/\s/g, "")), asOf, note });
      if (r.ok) {
        toast(b.saved);
        setAmount("");
        setNote("");
        router.refresh();
      } else toast(errorText(m, r.code), "error");
    });
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{b.title}</h2>
      <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 block sm:col-span-1">
          <span className="mb-1 block text-[0.72rem] text-muted-foreground">{b.amount}</span>
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-border-strong"
          />
        </label>
        <label className="col-span-2 block sm:col-span-1">
          <span className="mb-1 block text-[0.72rem] text-muted-foreground">{b.asOf}</span>
          <input
            type="date"
            required
            value={asOf}
            max={localToday()}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-border-strong"
          />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-[0.72rem] text-muted-foreground">{b.note}</span>
          <input
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-border-strong"
          />
        </label>
        <button type="submit" disabled={pending || !amount} className={cn(buttonVariants({ size: "sm" }), "col-span-2")}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {b.save}
        </button>
      </form>
      {sorted.length > 0 && (
        <div className="mt-4">
          <p className="text-[0.72rem] text-muted">{b.history}</p>
          <ul className="mt-1 divide-y divide-border">
            {sorted.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 py-1.5 text-[0.8125rem]">
                <span>
                  <span className="font-mono">{money(x.amount, locale)}</span>
                  <span className="text-muted"> · {day(x.asOf, locale)}</span>
                  {x.note && <span className="block text-[0.72rem] text-muted">{x.note}</span>}
                </span>
                <button
                  type="button"
                  aria-label={b.remove}
                  title={b.remove}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteBalance(x.id);
                      if (r.ok) {
                        toast(b.removed);
                        router.refresh();
                      } else toast(errorText(m, r.code), "error");
                    })
                  }
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * Undated transactions, each with the day read from what was typed (or a
 * blank to fill): the person checks, adjusts, applies. Nothing is dated
 * behind their back.
 */
export function DateAssistant({ txns }: { txns: FinanceTxn[] }) {
  const m = useMessages();
  const locale = useLocale();
  const d = m.founder.dates;
  const router = useRouter();
  const [pending, start] = useTransition();
  const undated = useMemo(() => txns.filter((t) => !t.occurredOn), [txns]);
  const proposals = useMemo(
    () =>
      Object.fromEntries(
        undated.map((t) => [t.id, proposeDate(t.date, t.createdAt.slice(0, 10), locale === "fr")])
      ),
    [undated, locale]
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(undated.map((t) => [t.id, proposals[t.id]?.date ?? ""]))
  );
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(undated.map((t) => [t.id, proposals[t.id]?.certainty === "exact"]))
  );
  const [open, setOpen] = useState(false);

  if (undated.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <CalendarCheck className="h-4 w-4 text-success" aria-hidden />
        {d.done}
      </p>
    );
  }
  const chosen = undated.filter((t) => checked[t.id] && /^\d{4}-\d{2}-\d{2}$/.test(values[t.id] ?? ""));

  return (
    <Card className="p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span>
          <span className="block text-sm font-semibold">{d.title}</span>
          <span className="mt-0.5 block text-[0.8125rem] text-warning">{plural(locale, undated.length, m.founder.treasury.undated)}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <>
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">{d.intro}</p>
          <ul className="mt-3 divide-y divide-border">
            {undated.map((t) => {
              const p = proposals[t.id];
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!checked[t.id]}
                    onChange={(e) => setChecked((c) => ({ ...c, [t.id]: e.target.checked }))}
                    aria-label={t.item}
                    className="h-4 w-4 accent-[hsl(var(--accent))]"
                  />
                  <span className="min-w-[10rem] flex-1">
                    <span className="block text-[0.875rem] font-medium">{t.item}</span>
                    <span className="block text-[0.72rem] text-muted">
                      {fill(d.typed, { text: t.date || "—" })} ·{" "}
                      <span className={p ? (p.certainty === "exact" ? "text-success" : "text-warning") : "text-danger"}>
                        {p ? (p.certainty === "exact" ? d.exact : d.inferred) : d.unreadable}
                      </span>
                    </span>
                  </span>
                  <span className={cn("font-mono text-[0.8125rem]", t.type === "Income" ? "text-success" : "text-foreground/80")}>
                    {t.type === "Income" ? "+" : "−"}
                    {money(t.amount, locale)}
                  </span>
                  <input
                    type="date"
                    value={values[t.id] ?? ""}
                    onChange={(e) => {
                      setValues((v) => ({ ...v, [t.id]: e.target.value }));
                      setChecked((c) => ({ ...c, [t.id]: !!e.target.value }));
                    }}
                    className="h-8 rounded-lg border border-border bg-surface-2/60 px-2 text-[0.8125rem] outline-none focus:border-border-strong"
                  />
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={pending || chosen.length === 0}
            onClick={() =>
              start(async () => {
                const r = await setTransactionDates(chosen.map((t) => ({ id: t.id, date: values[t.id] })));
                if (r.ok) {
                  toast(plural(locale, r.data.updated, d.applied));
                  router.refresh();
                } else toast(errorText(m, r.code), "error");
              })
            }
            className={cn(buttonVariants({ size: "sm" }), "mt-3")}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {plural(locale, chosen.length, d.apply)}
          </button>
        </>
      )}
    </Card>
  );
}
