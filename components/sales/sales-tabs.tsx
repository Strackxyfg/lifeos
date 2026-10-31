"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, FilePlus2, FileText, Loader2, Package, Users } from "lucide-react";
import { TabStrip } from "@/components/ui/tab-strip";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { createDocument } from "@/app/actions/sales";
import { attempt, failureText, SALES_TABS, zone, type SalesTab } from "./format";

const ICONS = { documents: FileText, clients: Users, catalog: Package, business: Building2 } as const;

/** Documents, clients, catalogue and the business: four faces of the same section, each with its own address. */
export function SalesTabs({ active }: { active: SalesTab }) {
  const t = useMessages().sales;
  return (
    <nav aria-label={t.title} className="mb-5 flex">
      <TabStrip activeKey={active} className="max-w-full rounded-lg border border-border bg-surface p-1" scrollerClassName="gap-1">
        {SALES_TABS.map((id) => {
          const Icon = ICONS[id];
          return (
            <Link
              key={id}
              href={id === "documents" ? "/sales" : `/sales?tab=${id}`}
              aria-current={active === id ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[0.8125rem] transition-colors [@media(pointer:coarse)]:py-2",
                active === id ? "bg-surface-2 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.tabs[id]}
            </Link>
          );
        })}
      </TabStrip>
    </nav>
  );
}

/** A new quote or invoice: a draft, opened at once. */
export function NewDocuments() {
  const t = useMessages().sales;
  const router = useRouter();
  const [busy, setBusy] = useState<"quote" | "invoice" | null>(null);

  const create = async (kind: "quote" | "invoice") => {
    setBusy(kind);
    const r = await attempt(() => createDocument(kind, null, zone()));
    if (r.ok) router.push(`/sales/${r.data.id}`);
    else {
      setBusy(null);
      toast(failureText(t, r), "error");
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {(["quote", "invoice"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={busy !== null}
          onClick={() => create(kind)}
          className={cn(buttonVariants({ size: "sm", variant: kind === "invoice" ? "primary" : "secondary" }))}
        >
          {busy === kind ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FilePlus2 className="h-3.5 w-3.5" aria-hidden />}
          {kind === "quote" ? t.newQuote : t.newInvoice}
        </button>
      ))}
    </div>
  );
}
