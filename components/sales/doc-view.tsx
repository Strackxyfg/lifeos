"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BellRing, Copy, FileMinus2, FileOutput, Info, Lock, Printer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { Modal } from "@/components/maps/modal";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/sales/legal";
import type { DocKind, SalesDoc } from "@/lib/sales/model";
import { convertQuote, creditInvoice, duplicateDocument, markQuote } from "@/app/actions/sales";
import { StatusPill } from "./doc-list";
import { DocSheet } from "./doc-sheet";
import { attempt, day, failureText, zone } from "./format";
import { Payments } from "./payments";
import { ReminderDialog } from "./reminder-dialog";
import { reminderOf } from "@/lib/sales/reminder";

export interface FollowUp {
  id: string;
  kind: DocKind;
  number: string | null;
}

/**
 * An issued document: the sheet as it was issued, frozen, and what can still
 * happen to it — a quote answered or turned into an invoice, an invoice paid
 * or cancelled by a credit note, any document copied into a new draft.
 */
export function DocView({ doc, status, followUps, today }: { doc: SalesDoc; status: Status; followUps: FollowUp[]; today: string }) {
  const t = useMessages().sales;
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCredit, setConfirmCredit] = useState(false);
  const [reminding, setReminding] = useState(false);
  const reminder = reminderOf(doc, today);

  const run = async (key: string, action: () => Promise<{ ok: true; data: { id: string } | null } | Parameters<typeof failureText>[1]>, done?: string) => {
    setBusy(key);
    const r = await action();
    setBusy(null);
    setConfirmCredit(false);
    if (!r.ok) return toast(failureText(t, r), "error");
    if (done) toast(done);
    if (r.data && "id" in r.data) router.push(`/sales/${r.data.id}`);
    else router.refresh();
  };

  const answer = (state: "open" | "accepted" | "declined") => run(state, () => attempt(() => markQuote(doc.id, state)));
  const quoteState = doc.state === "accepted" ? "accepted" : doc.state === "declined" ? "declined" : "open";
  const canConvert = doc.kind === "quote" && doc.state !== "invoiced" && doc.state !== "declined";
  const canCredit = doc.kind === "invoice" && doc.state !== "cancelled";

  return (
    <>
      <Link href="/sales" className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t.editor.back}
      </Link>
      <div className="mb-6 flex flex-col gap-3 print:hidden sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.8125rem] text-muted-foreground">{t.kinds[doc.kind]}</p>
          <h1 className="flex flex-wrap items-center gap-3 font-mono text-[1.5rem] font-medium tracking-tight">
            {doc.number}
            <StatusPill status={status} kind={doc.kind} />
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-muted">
            <Lock className="h-3 w-3" aria-hidden />
            {fill(t.doc.frozen, { date: day(doc.content.issueDate, locale) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Printer className="h-3.5 w-3.5" aria-hidden />
            {t.doc.print}
          </button>
          {doc.kind !== "credit" && (
            <button type="button" disabled={busy !== null} onClick={() => run("dup", () => attempt(() => duplicateDocument(doc.id, zone())), t.doc.duplicated)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {t.doc.duplicate}
            </button>
          )}
          {canConvert && (
            <button type="button" disabled={busy !== null} onClick={() => run("convert", () => attempt(() => convertQuote(doc.id, zone())), t.doc.converted)} className={buttonVariants({ size: "sm" })}>
              <FileOutput className="h-3.5 w-3.5" aria-hidden />
              {t.doc.convert}
            </button>
          )}
          {reminder && (
            <button
              type="button"
              onClick={() => setReminding(true)}
              className={buttonVariants({ variant: status === "overdue" ? "primary" : "secondary", size: "sm" })}
            >
              <BellRing className="h-3.5 w-3.5" aria-hidden />
              {t.reminder.button}
            </button>
          )}
          {canCredit && (
            <button type="button" disabled={busy !== null} onClick={() => setConfirmCredit(true)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <FileMinus2 className="h-3.5 w-3.5" aria-hidden />
              {t.doc.credit}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <DocSheet kind={doc.kind} number={doc.number} content={doc.content} totals={doc.totals} payments={doc.payments} cancelled={doc.state === "cancelled"} issuer={doc.content.issuer ?? null} client={doc.content.client ?? null} />

        <aside className="space-y-4 print:hidden">
          {doc.kind === "quote" && doc.state !== "invoiced" && (
            <Card className="p-4">
              <h2 className="mb-2 text-[0.875rem] font-semibold">{t.doc.answer}</h2>
              <div role="group" aria-label={t.doc.answer} className="flex flex-wrap gap-1">
                {(["open", "accepted", "declined"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={quoteState === s}
                    disabled={busy !== null}
                    onClick={() => quoteState !== s && answer(s)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-[0.8125rem] transition-colors [@media(pointer:coarse)]:py-1.5",
                      quoteState === s ? "border-border-strong bg-surface-2 font-medium" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s === "open" ? t.doc.reopen : s === "accepted" ? t.doc.accept : t.doc.decline}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {doc.kind === "invoice" && <Payments doc={doc} today={today} />}

          {(doc.content.relatedId || followUps.length > 0) && (
            <Card className="space-y-1.5 p-4 text-[0.8125rem]">
              {doc.content.relatedId && (
                <Link href={`/sales/${doc.content.relatedId}`} className="block text-accent underline-offset-2 hover:underline">
                  {fill(doc.kind === "credit" ? t.editor.onInvoice : t.editor.related, { number: doc.content.relatedNumber ?? "" })}
                </Link>
              )}
              {followUps.map((f) => (
                <Link key={f.id} href={`/sales/${f.id}`} className="block text-accent underline-offset-2 hover:underline">
                  {t.kinds[f.kind]} {f.number ?? `(${t.status.draft.toLowerCase()})`}
                </Link>
              ))}
            </Card>
          )}

          {doc.kind === "invoice" && (
            <p className="flex gap-2 text-[0.75rem] leading-relaxed text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t.doc.einvoice}
            </p>
          )}
        </aside>
      </div>

      {reminder && <ReminderDialog open={reminding} onClose={() => setReminding(false)} number={doc.number ?? ""} reminder={reminder} />}

      <Modal open={confirmCredit} onClose={() => setConfirmCredit(false)} title={t.doc.creditTitle} closeLabel={t.close}>
        <div className="space-y-4 p-5">
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">{t.doc.creditBody}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmCredit(false)} className={buttonVariants({ variant: "ghost", size: "sm" })} data-autofocus>
              {t.cancel}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => run("credit", () => attempt(() => creditInvoice(doc.id, zone())), t.doc.credited)} className={buttonVariants({ size: "sm" })}>
              <FileMinus2 className="h-3.5 w-3.5" aria-hidden />
              {t.doc.creditConfirm}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
