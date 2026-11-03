"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { Client } from "@/lib/sales/model";
import { saveClient } from "@/app/actions/sales";
import { areaCls, Field, inputCls } from "./fields";
import { attempt, failureText } from "./format";

const blank = { kind: "company" as Client["kind"], name: "", contact: "", email: "", phone: "", line1: "", line2: "", postalCode: "", city: "", country: "France", siren: "", vatNumber: "", notes: "" };

/** A client, new or edited. Used from the clients tab and from a document being written. */
export function ClientForm({ client, onSaved, onCancel }: { client: Client | null; onSaved: (c: Client) => void; onCancel: () => void }) {
  const t = useMessages().sales;
  const f = t.clients.fields;
  const [v, setV] = useState<typeof blank>(() =>
    client
      ? {
          kind: client.kind,
          name: client.name,
          contact: client.contact ?? "",
          email: client.email ?? "",
          phone: client.phone ?? "",
          line1: client.address.line1,
          line2: client.address.line2 ?? "",
          postalCode: client.address.postalCode,
          city: client.address.city,
          country: client.address.country,
          siren: client.siren ?? "",
          vatNumber: client.vatNumber ?? "",
          notes: client.notes ?? "",
        }
      : blank
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const err = (k: string) => (error?.field === k ? error.text : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input = {
      kind: v.kind,
      name: v.name,
      contact: v.contact,
      email: v.email,
      phone: v.phone,
      address: { line1: v.line1, line2: v.line2, postalCode: v.postalCode, city: v.city, country: v.country || "France" },
      siren: v.siren.replace(/\s/g, ""),
      vatNumber: v.vatNumber.replace(/\s/g, "").toUpperCase(),
      notes: v.notes,
    };
    const r = await attempt(() => saveClient(client?.id ?? null, input));
    setBusy(false);
    if (r.ok) {
      toast(t.clients.saved);
      onSaved(r.data);
    } else {
      const field = r.field?.split(".").pop() ?? "";
      setError({ field, text: failureText(t, r) });
      if (!field) toast(failureText(t, r), "error");
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 p-5 sm:grid-cols-2" noValidate>
      <Field label={f.kind} wide>
        {(p) => (
          <select {...p} value={v.kind} onChange={set("kind")} className={inputCls}>
            <option value="company">{t.clients.kind.company}</option>
            <option value="person">{t.clients.kind.person}</option>
          </select>
        )}
      </Field>
      <Field label={f.name} error={err("name")} wide>
        {(p) => <input {...p} required value={v.name} onChange={set("name")} className={inputCls} autoComplete="organization" data-autofocus />}
      </Field>
      <Field label={f.contact}>{(p) => <input {...p} value={v.contact} onChange={set("contact")} className={inputCls} autoComplete="name" />}</Field>
      <Field label={f.email} error={err("email")}>
        {(p) => <input {...p} type="email" value={v.email} onChange={set("email")} className={inputCls} autoComplete="email" />}
      </Field>
      <Field label={f.line1} error={err("line1")} wide>
        {(p) => <input {...p} value={v.line1} onChange={set("line1")} className={inputCls} autoComplete="address-line1" />}
      </Field>
      <Field label={f.line2} wide>{(p) => <input {...p} value={v.line2} onChange={set("line2")} className={inputCls} autoComplete="address-line2" />}</Field>
      <Field label={f.postalCode}>{(p) => <input {...p} value={v.postalCode} onChange={set("postalCode")} className={inputCls} autoComplete="postal-code" />}</Field>
      <Field label={f.city}>{(p) => <input {...p} value={v.city} onChange={set("city")} className={inputCls} autoComplete="address-level2" />}</Field>
      <Field label={f.country}>{(p) => <input {...p} value={v.country} onChange={set("country")} className={inputCls} autoComplete="country-name" />}</Field>
      <Field label={f.phone}>{(p) => <input {...p} type="tel" value={v.phone} onChange={set("phone")} className={inputCls} autoComplete="tel" />}</Field>
      {v.kind === "company" && (
        <>
          <Field label={f.siren} error={err("siren")}>{(p) => <input {...p} inputMode="numeric" value={v.siren} onChange={set("siren")} className={inputCls} />}</Field>
          <Field label={f.vatNumber} error={err("vatNumber")}>{(p) => <input {...p} value={v.vatNumber} onChange={set("vatNumber")} className={inputCls} />}</Field>
        </>
      )}
      <Field label={f.notes} wide>{(p) => <textarea {...p} rows={2} value={v.notes} onChange={set("notes")} className={areaCls} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t.cancel}
        </button>
        <button type="submit" disabled={busy} className={buttonVariants({ size: "sm" })}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {busy ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}
