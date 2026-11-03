"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, Package, Pencil, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { Modal } from "@/components/maps/modal";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { FRENCH_VAT_BP, formatRate, parseEuros } from "@/lib/sales/compute";
import type { CatalogItem } from "@/lib/sales/model";
import { archiveCatalogItem, saveCatalogItem } from "@/app/actions/sales";
import { areaCls, eurosOf, Field, inputCls } from "./fields";
import { attempt, failureText, money } from "./format";

function CatalogForm({ item, onDone }: { item: CatalogItem | null; onDone: (saved: boolean) => void }) {
  const t = useMessages().sales;
  const locale = useLocale();
  const f = t.catalog.fields;
  const [v, setV] = useState({
    name: item?.name ?? "",
    description: item?.description ?? "",
    unit: item?.unit ?? (locale === "fr" ? "jour" : "day"),
    price: eurosOf(item?.unitPriceCents, locale),
    vatBp: item?.vatBp ?? 2000,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const err = (k: string) => (error?.field === k ? error.text : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseEuros(v.price);
    if (cents === null) return setError({ field: "unitPrice", text: t.fieldErrors.unitPrice });
    if (!v.name.trim()) return setError({ field: "name", text: t.fieldErrors.name });
    if (!v.unit.trim()) return setError({ field: "unit", text: t.fieldErrors.unit });
    setBusy(true);
    setError(null);
    const r = await attempt(() => saveCatalogItem(item?.id ?? null, { name: v.name, description: v.description, unit: v.unit, unitPriceCents: cents, vatBp: v.vatBp }));
    setBusy(false);
    if (r.ok) {
      toast(t.catalog.saved);
      onDone(true);
    } else toast(failureText(t, r), "error");
  };

  return (
    <form onSubmit={submit} className="grid gap-3 p-5 sm:grid-cols-2" noValidate>
      <Field label={f.name} error={err("name")} wide>
        {(p) => <input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputCls} data-autofocus />}
      </Field>
      <Field label={f.description} wide>
        {(p) => <textarea {...p} rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={areaCls} />}
      </Field>
      <Field label={f.unitPrice} error={err("unitPrice")}>
        {(p) => <input {...p} inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} className={cn(inputCls, "tabular-nums")} placeholder="0,00" />}
      </Field>
      <Field label={f.unit} error={err("unit")}>
        {(p) => <input {...p} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} className={inputCls} />}
      </Field>
      <Field label={f.vat}>
        {(p) => (
          <select {...p} value={v.vatBp} onChange={(e) => setV({ ...v, vatBp: Number(e.target.value) })} className={inputCls}>
            {FRENCH_VAT_BP.map((bp) => (
              <option key={bp} value={bp}>
                {formatRate(bp, locale)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={() => onDone(false)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
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

/** What is sold often, with its price and VAT rate, to add to a document in one click. */
export function CatalogPanel({ items }: { items: CatalogItem[] }) {
  const t = useMessages().sales;
  const locale = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const shown = items.filter((i) => showArchived || !i.archived);

  const toggleArchive = async (i: CatalogItem) => {
    const r = await attempt(() => archiveCatalogItem(i.id, !i.archived));
    if (r.ok) router.refresh();
    else toast(failureText(t, r), "error");
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {items.some((i) => i.archived) ? (
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4" />
            {t.catalog.showArchived}
          </label>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => setEditing("new")} className={buttonVariants({ size: "sm" })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t.catalog.new}
        </button>
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title={t.catalog.emptyTitle} description={t.catalog.emptyBody} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {shown.map((i) => (
              <li key={i.id} className={cn("flex items-center gap-3 border-b border-border px-4 py-3 last:border-0", i.archived && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.875rem] font-medium">{i.name}</p>
                  <p className="truncate text-[0.75rem] text-muted-foreground">
                    {money(i.unitPriceCents, locale)} {fill(t.catalog.perUnit, { unit: i.unit })} · {formatRate(i.vatBp, locale)}
                    {i.description ? ` · ${i.description}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => setEditing(i)} aria-label={`${t.edit} — ${i.name}`} className={buttonVariants({ variant: "ghost", size: "icon" })}>
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => toggleArchive(i)}
                  aria-label={`${i.archived ? t.catalog.restore : t.catalog.archive} — ${i.name}`}
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                >
                  {i.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t.catalog.newTitle : t.catalog.editTitle} closeLabel={t.close} wide>
        {editing !== null && (
          <CatalogForm
            item={editing === "new" ? null : editing}
            onDone={(saved) => {
              setEditing(null);
              if (saved) router.refresh();
            }}
          />
        )}
      </Modal>
    </>
  );
}
