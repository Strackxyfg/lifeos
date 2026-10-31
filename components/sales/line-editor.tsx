"use client";

import { ArrowDown, ArrowUp, Package, Plus, Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { FRENCH_VAT_BP, formatRate, lineNet, parseEuros, type Line } from "@/lib/sales/compute";
import type { CatalogItem } from "@/lib/sales/model";
import { eurosOf, inputCls } from "./fields";
import { money } from "./format";

/** A line as typed: numbers stay text until they are read, so "1,5" can be typed. */
export interface LineDraft {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  vatBp: number;
  discount: string;
}

const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/** A typed line as numbers; `null` fields are not valid as typed. */
export function readLine(d: LineDraft): { line: Line; bad: Array<"quantity" | "price" | "discount"> } {
  const bad: Array<"quantity" | "price" | "discount"> = [];
  const q = num(d.quantity);
  if (!Number.isFinite(q) || q < 0 || q > 1e6) bad.push("quantity");
  const cents = parseEuros(d.price || "0");
  if (cents === null) bad.push("price");
  const disc = d.discount.trim() ? num(d.discount) : 0;
  if (!Number.isFinite(disc) || disc < 0 || disc > 100) bad.push("discount");
  return {
    line: {
      id: d.id,
      description: d.description,
      quantity: Number.isFinite(q) && q >= 0 ? Math.round(Math.min(q, 1e6) * 1000) / 1000 : 0,
      unit: d.unit,
      unitPriceCents: cents ?? 0,
      vatBp: d.vatBp,
      discountBp: Number.isFinite(disc) ? Math.round(Math.min(Math.max(disc, 0), 100) * 100) : 0,
    },
    bad,
  };
}

export function draftOf(l: Line, locale: "fr" | "en"): LineDraft {
  const dec = (n: number) => (locale === "fr" ? String(n).replace(".", ",") : String(n));
  return { id: l.id, description: l.description, quantity: dec(l.quantity), unit: l.unit, price: eurosOf(l.unitPriceCents, locale), vatBp: l.vatBp, discount: l.discountBp ? dec(l.discountBp / 100) : "" };
}

export function newLine(locale: "fr" | "en", from?: CatalogItem): LineDraft {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return from
    ? { id, description: [from.name, from.description].filter(Boolean).join("\n"), quantity: "1", unit: from.unit, price: eurosOf(from.unitPriceCents, locale), vatBp: from.vatBp, discount: "" }
    : { id, description: "", quantity: "1", unit: locale === "fr" ? "unité" : "unit", price: "", vatBp: 2000, discount: "" };
}

/** The lines of a draft: typed in place, moved, removed, or taken from the catalogue. */
export function LineEditor({
  lines,
  onChange,
  catalog,
  franchise,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  catalog: CatalogItem[];
  franchise: boolean;
}) {
  const t = useMessages().sales;
  const e = t.editor;
  const locale = useLocale();
  const update = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...lines];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const small = "text-[0.72rem] text-muted-foreground";

  return (
    <div>
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-[0.8125rem] text-muted-foreground">{e.noLines}</p>
      ) : (
        <ol className="space-y-3">
          {lines.map((d, i) => {
            const { line, bad } = readLine(d);
            return (
              <li key={d.id} className="rounded-lg border border-border bg-surface-2/30 p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_7.5rem_6rem_5rem]">
                  <label className="col-span-2 flex flex-col gap-1 sm:col-span-6">
                    <span className={small}>{e.description}</span>
                    <textarea rows={2} value={d.description} onChange={(ev) => update(i, { description: ev.target.value })} className={cn(inputCls, "h-auto py-2")} />
                  </label>
                  <label className="flex flex-col gap-1 sm:col-start-2">
                    <span className={small}>{e.quantity}</span>
                    <input inputMode="decimal" value={d.quantity} aria-invalid={bad.includes("quantity")} onChange={(ev) => update(i, { quantity: ev.target.value })} className={cn(inputCls, "tabular-nums")} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={small}>{e.unit}</span>
                    <input value={d.unit} onChange={(ev) => update(i, { unit: ev.target.value })} className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={small}>{e.unitPrice}</span>
                    <input inputMode="decimal" value={d.price} placeholder="0,00" aria-invalid={bad.includes("price")} onChange={(ev) => update(i, { price: ev.target.value })} className={cn(inputCls, "tabular-nums")} />
                  </label>
                  {franchise ? (
                    <span className="max-sm:hidden" />
                  ) : (
                    <label className="flex flex-col gap-1">
                      <span className={small}>{e.vat}</span>
                      <select value={d.vatBp} onChange={(ev) => update(i, { vatBp: Number(ev.target.value) })} className={inputCls}>
                        {[...new Set([...FRENCH_VAT_BP, d.vatBp])].map((bp) => (
                          <option key={bp} value={bp}>
                            {formatRate(bp, locale)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className={small}>{e.discount}</span>
                    <input inputMode="decimal" value={d.discount} placeholder="0" aria-invalid={bad.includes("discount")} onChange={(ev) => update(i, { discount: ev.target.value })} className={cn(inputCls, "tabular-nums")} />
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <span className="mr-auto text-[0.8125rem]">
                    <span className="text-muted-foreground">{e.lineTotal} </span>
                    <span className="font-medium tabular-nums">{money(lineNet(line), locale)}</span>
                  </span>
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={e.moveUp} className={buttonVariants({ variant: "ghost", size: "icon" })}>
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label={e.moveDown} className={buttonVariants({ variant: "ghost", size: "icon" })}>
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={e.removeLine} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "hover:text-danger")}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onChange([...lines, newLine(locale)])} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {e.addLine}
        </button>
        {catalog.length > 0 && (
          <label className="relative">
            <span className="sr-only">{e.fromCatalog}</span>
            <Package className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <select
              value=""
              onChange={(ev) => {
                const item = catalog.find((c) => c.id === ev.target.value);
                if (item) onChange([...lines, newLine(locale, item)]);
              }}
              className={cn(inputCls, "h-8 w-auto pl-8 pr-8 sm:h-8 sm:text-[0.8125rem]")}
            >
              <option value="">{e.fromCatalog}</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {money(c.unitPriceCents, locale)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
