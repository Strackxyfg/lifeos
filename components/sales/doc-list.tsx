"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { DocRow } from "@/lib/sales/overview";
import { day, money, TONE } from "./format";

type Filter = "all" | "quote" | "invoice" | "credit";

export function StatusPill({ status, kind }: { status: DocRow["status"]; kind: DocRow["kind"] }) {
  const t = useMessages().sales;
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.7rem] font-medium", TONE[status])}>
      {kind === "credit" && status === "issued" ? t.creditIssued : t.status[status]}
    </span>
  );
}

/** Every document, newest first, drafts on top; a filter by kind and a search on number and client. */
export function DocList({ rows }: { rows: DocRow[] }) {
  const t = useMessages().sales;
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) => (filter === "all" || r.kind === filter) && (!needle || (r.number ?? "").toLowerCase().includes(needle) || (r.clientName ?? "").toLowerCase().includes(needle))
    );
  }, [rows, filter, q]);

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={FileText} title={t.list.emptyTitle} description={t.list.emptyBody} />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label={t.tabs.documents} className="flex flex-wrap gap-1">
          {(["all", "quote", "invoice", "credit"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[0.8125rem] transition-colors [@media(pointer:coarse)]:py-1.5",
                filter === f ? "bg-surface-2 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.filters[f]}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <span className="sr-only">{t.filters.search}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.filters.search}
            className="h-9 w-full rounded-md border border-border bg-surface-2/40 pl-8 pr-3 text-base outline-none transition-colors focus:border-border-strong sm:text-[0.8125rem]"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="p-6 text-center text-[0.8125rem] text-muted-foreground">{t.list.none}</p>
      ) : (
        <ul>
          <li aria-hidden className="hidden gap-3 md:grid-cols-[9rem_minmax(0,1fr)_7rem_8rem_9rem] border-b border-border bg-surface-2/40 px-4 py-2 text-[0.7rem] uppercase tracking-wider text-muted md:grid">
            <span>{t.list.number}</span>
            <span>{t.list.client}</span>
            <span>{t.list.date}</span>
            <span className="text-right">{t.list.total}</span>
            <span>{t.list.status}</span>
          </li>
          {shown.map((r) => (
            <li key={r.id} className="border-b border-border last:border-0">
              <Link
                href={`/sales/${r.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-surface-2/40 md:grid-cols-[9rem_minmax(0,1fr)_7rem_8rem_9rem] md:items-center md:py-2.5"
              >
                <span className="font-mono text-[0.8125rem]">
                  {r.number ?? <span className="font-sans text-muted-foreground">{t.kinds[r.kind]}</span>}
                </span>
                <span className="text-right font-medium tabular-nums md:order-4 md:font-normal">{money(r.grossCents, locale)}</span>
                <span className={cn("truncate text-[0.875rem] md:order-2", !r.clientName && "text-muted")}>{r.clientName ?? t.list.noClient}</span>
                <span className="text-right text-[0.8125rem] text-muted-foreground md:order-3 md:text-left">{day(r.issueDate, locale)}</span>
                <span className="col-span-2 md:order-5 md:col-span-1">
                  <StatusPill status={r.status} kind={r.kind} />
                  {r.number && r.kind !== "quote" && <span className="ml-2 text-[0.72rem] text-muted md:hidden">{t.kinds[r.kind]}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
