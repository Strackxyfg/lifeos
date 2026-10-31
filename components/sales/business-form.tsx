"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { parseEuros } from "@/lib/sales/compute";
import { LEGAL_FORMS, type Issuer } from "@/lib/sales/model";
import { saveIssuer } from "@/app/actions/sales";
import { eurosOf, Field, inputCls } from "./fields";
import { attempt, failureText } from "./format";

type Form = Record<
  | "legalName" | "tradeName" | "form" | "capital" | "line1" | "line2" | "postalCode" | "city" | "country" | "siren" | "siret" | "registry"
  | "email" | "phone" | "vatNumber" | "iban" | "bic" | "paymentDays" | "latePenalty" | "quoteValidityDays" | "footer",
  string
> & { vatRegime: Issuer["vatRegime"]; vatOnDebits: boolean };

function formOf(i: Issuer | null, locale: "fr" | "en"): Form {
  return {
    legalName: i?.legalName ?? "",
    tradeName: i?.tradeName ?? "",
    form: i?.form ?? "",
    capital: eurosOf(i?.capitalCents, locale),
    line1: i?.address.line1 ?? "",
    line2: i?.address.line2 ?? "",
    postalCode: i?.address.postalCode ?? "",
    city: i?.address.city ?? "",
    country: i?.address.country ?? "France",
    siren: i?.siren ?? "",
    siret: i?.siret ?? "",
    registry: i?.registry ?? "",
    email: i?.email ?? "",
    phone: i?.phone ?? "",
    vatRegime: i?.vatRegime ?? "franchise",
    vatNumber: i?.vatNumber ?? "",
    vatOnDebits: i?.vatOnDebits ?? false,
    iban: i?.iban ?? "",
    bic: i?.bic ?? "",
    paymentDays: String(i?.paymentDays ?? 30),
    latePenalty: i?.latePenalty ?? "Trois fois le taux d'intérêt légal",
    quoteValidityDays: String(i?.quoteValidityDays ?? 30),
    footer: i?.footer ?? "",
  };
}

const compact = (s: string) => s.replace(/\s/g, "");

/** The business behind every document. Saving it never touches what is already issued. */
export function BusinessForm({ issuer }: { issuer: Issuer | null }) {
  const t = useMessages().sales;
  const locale = useLocale();
  const router = useRouter();
  const f = t.business.fields;
  const [v, setV] = useState<Form>(() => formOf(issuer, locale));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const err = (k: string) => (error?.field === k ? error.text : null);
  const company = v.form !== "" && !["EI", "EIRL", "Micro-entreprise", "Association", "Autre"].includes(v.form);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const capitalCents = company && v.capital.trim() ? parseEuros(v.capital) : undefined;
    if (capitalCents === null) return setError({ field: "capital", text: t.fieldErrors.unitPrice });
    setBusy(true);
    setError(null);
    const r = await attempt(() =>
      saveIssuer({
        legalName: v.legalName,
        tradeName: v.tradeName,
        form: v.form || undefined,
        capitalCents,
        address: { line1: v.line1, line2: v.line2, postalCode: v.postalCode, city: v.city, country: v.country || "France" },
        siren: compact(v.siren),
        siret: compact(v.siret),
        registry: v.registry,
        vatRegime: v.vatRegime,
        vatNumber: v.vatRegime === "normal" ? compact(v.vatNumber).toUpperCase() : "",
        vatOnDebits: v.vatRegime === "normal" && v.vatOnDebits,
        email: v.email,
        phone: v.phone,
        iban: compact(v.iban).toUpperCase(),
        bic: compact(v.bic).toUpperCase(),
        paymentDays: Number(v.paymentDays) || 0,
        latePenalty: v.latePenalty,
        quoteValidityDays: Number(v.quoteValidityDays) || 30,
        footer: v.footer,
      })
    );
    setBusy(false);
    if (r.ok) {
      toast(t.business.saved);
      router.refresh();
    } else {
      const field = r.field?.split(".").pop() ?? "";
      setError({ field, text: failureText(t, r) });
      toast(failureText(t, r), "error");
    }
  };

  const section = "grid gap-3 sm:grid-cols-2";
  const heading = "text-[0.8125rem] font-semibold sm:col-span-2";

  return (
    <Card className="p-5 sm:p-6">
      <p className="mb-5 max-w-2xl text-[0.8125rem] leading-relaxed text-muted-foreground">{t.business.intro}</p>
      <form onSubmit={submit} className="space-y-7" noValidate>
        <div className={section}>
          <h2 className={heading}>{t.business.identity}</h2>
          <Field label={f.legalName} error={err("legalName")}>{(p) => <input {...p} value={v.legalName} onChange={set("legalName")} className={inputCls} autoComplete="organization" />}</Field>
          <Field label={f.tradeName}>{(p) => <input {...p} value={v.tradeName} onChange={set("tradeName")} className={inputCls} />}</Field>
          <Field label={f.form}>
            {(p) => (
              <select {...p} value={v.form} onChange={set("form")} className={inputCls}>
                <option value="">—</option>
                {LEGAL_FORMS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {company ? (
            <Field label={f.capital} error={err("capital")}>{(p) => <input {...p} inputMode="decimal" value={v.capital} onChange={set("capital")} className={cn(inputCls, "tabular-nums")} />}</Field>
          ) : (
            <span className="max-sm:hidden" />
          )}
          <Field label={f.siren} hint={t.business.hints.siren} error={err("siren")}>{(p) => <input {...p} inputMode="numeric" value={v.siren} onChange={set("siren")} className={inputCls} />}</Field>
          <Field label={f.siret} error={err("siret")}>{(p) => <input {...p} inputMode="numeric" value={v.siret} onChange={set("siret")} className={inputCls} />}</Field>
          <Field label={f.registry}>{(p) => <input {...p} value={v.registry} onChange={set("registry")} className={inputCls} />}</Field>
          <span className="max-sm:hidden" />
          <Field label={t.clients.fields.line1} wide>{(p) => <input {...p} value={v.line1} onChange={set("line1")} className={inputCls} autoComplete="address-line1" />}</Field>
          <Field label={t.clients.fields.line2} wide>{(p) => <input {...p} value={v.line2} onChange={set("line2")} className={inputCls} autoComplete="address-line2" />}</Field>
          <Field label={t.clients.fields.postalCode}>{(p) => <input {...p} value={v.postalCode} onChange={set("postalCode")} className={inputCls} autoComplete="postal-code" />}</Field>
          <Field label={t.clients.fields.city}>{(p) => <input {...p} value={v.city} onChange={set("city")} className={inputCls} autoComplete="address-level2" />}</Field>
          <Field label={t.clients.fields.country}>{(p) => <input {...p} value={v.country} onChange={set("country")} className={inputCls} autoComplete="country-name" />}</Field>
          <span className="max-sm:hidden" />
          <Field label={f.email} error={err("email")}>{(p) => <input {...p} type="email" value={v.email} onChange={set("email")} className={inputCls} autoComplete="email" />}</Field>
          <Field label={f.phone}>{(p) => <input {...p} type="tel" value={v.phone} onChange={set("phone")} className={inputCls} autoComplete="tel" />}</Field>
        </div>

        <fieldset className={section}>
          <legend className={cn(heading, "mb-3")}>{t.business.vat}</legend>
          <div className="flex flex-col gap-2 sm:col-span-2" role="radiogroup" aria-label={f.vatRegime}>
            {(["franchise", "normal"] as const).map((r) => (
              <label key={r} className="flex items-start gap-2 text-[0.875rem]">
                <input type="radio" name="vatRegime" value={r} checked={v.vatRegime === r} onChange={() => setV((s) => ({ ...s, vatRegime: r }))} className="mt-1 h-4 w-4" />
                {f[r]}
              </label>
            ))}
          </div>
          {v.vatRegime === "normal" && (
            <>
              <Field label={f.vatNumber} error={err("vatNumber")}>{(p) => <input {...p} value={v.vatNumber} onChange={set("vatNumber")} className={inputCls} placeholder="FR…" />}</Field>
              <label className="flex items-start gap-2 self-end pb-2 text-[0.8125rem] text-muted-foreground">
                <input type="checkbox" checked={v.vatOnDebits} onChange={(e) => setV((s) => ({ ...s, vatOnDebits: e.target.checked }))} className="mt-0.5 h-4 w-4" />
                {f.vatOnDebits}
              </label>
            </>
          )}
        </fieldset>

        <div className={section}>
          <h2 className={heading}>{t.business.payment}</h2>
          <Field label={f.iban} error={err("iban")}>{(p) => <input {...p} value={v.iban} onChange={set("iban")} className={cn(inputCls, "font-mono")} />}</Field>
          <Field label={f.bic} error={err("bic")}>{(p) => <input {...p} value={v.bic} onChange={set("bic")} className={cn(inputCls, "font-mono")} />}</Field>
          <Field label={f.paymentDays} hint={t.business.hints.paymentDays} error={err("paymentDays")}>
            {(p) => <input {...p} type="number" min={0} max={60} value={v.paymentDays} onChange={set("paymentDays")} className={inputCls} />}
          </Field>
          <Field label={f.quoteValidityDays} error={err("quoteValidityDays")}>
            {(p) => <input {...p} type="number" min={1} max={365} value={v.quoteValidityDays} onChange={set("quoteValidityDays")} className={inputCls} />}
          </Field>
          <Field label={f.latePenalty} hint={t.business.hints.latePenalty} wide>{(p) => <input {...p} value={v.latePenalty} onChange={set("latePenalty")} className={inputCls} />}</Field>
          <Field label={f.footer} wide>{(p) => <textarea {...p} rows={2} value={v.footer} onChange={set("footer")} className={cn(inputCls, "h-auto py-2")} />}</Field>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={buttonVariants({ size: "md" })}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? t.saving : t.save}
          </button>
        </div>
      </form>
    </Card>
  );
}
