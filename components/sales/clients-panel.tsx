"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { Modal } from "@/components/maps/modal";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { Client } from "@/lib/sales/model";
import { archiveClient } from "@/app/actions/sales";
import { ClientForm } from "./client-form";
import { attempt, failureText } from "./format";

/** The client directory: add, edit, archive. A client on an issued document stays there as it was. */
export function ClientsPanel({ clients, docCounts }: { clients: Client[]; docCounts: Record<string, number> }) {
  const t = useMessages().sales;
  const locale = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const shown = clients.filter((c) => showArchived || !c.archived);
  const hasArchived = clients.some((c) => c.archived);

  const toggleArchive = async (c: Client) => {
    const r = await attempt(() => archiveClient(c.id, !c.archived));
    if (r.ok) router.refresh();
    else toast(failureText(t, r), "error");
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {hasArchived ? (
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-current" />
            {t.clients.showArchived}
          </label>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => setEditing("new")} className={buttonVariants({ size: "sm" })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t.clients.new}
        </button>
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={t.clients.emptyTitle} description={t.clients.emptyBody} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {shown.map((c) => (
              <li key={c.id} className={cn("flex items-center gap-3 border-b border-border px-4 py-3 last:border-0", c.archived && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.875rem] font-medium">
                    {c.name}
                    {c.archived && <span className="ml-2 text-[0.72rem] font-normal text-muted">{t.clients.archived}</span>}
                  </p>
                  <p className="truncate text-[0.75rem] text-muted-foreground">
                    {[t.clients.kind[c.kind], c.address.city, c.email].filter(Boolean).join(" · ")}
                    {docCounts[c.id] ? ` · ${plural(locale, docCounts[c.id], t.clients.docs)}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => setEditing(c)} aria-label={`${t.edit} — ${c.name}`} className={buttonVariants({ variant: "ghost", size: "icon" })}>
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => toggleArchive(c)}
                  aria-label={`${c.archived ? t.clients.restore : t.clients.archive} — ${c.name}`}
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                >
                  {c.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t.clients.newTitle : t.clients.editTitle} closeLabel={t.close} wide>
        {editing !== null && (
          <ClientForm
            client={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </>
  );
}
