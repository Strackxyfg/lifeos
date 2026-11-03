"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, CircleAlert, Loader2, Send, Trash2, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { Modal } from "@/components/maps/modal";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { totalsOf } from "@/lib/sales/compute";
import { checkBeforeIssue, type Problem } from "@/lib/sales/legal";
import { NATURES, type Nature } from "@/lib/sales/constants";
import type { CatalogItem, Client, DocContent, Issuer, SalesDoc } from "@/lib/sales/model";
import { deleteDraftDocument, issueDocument, saveDraftDocument } from "@/app/actions/sales";
import { ClientForm } from "./client-form";
import { DocSheet } from "./doc-sheet";
import { areaCls, Field, inputCls } from "./fields";
import { attempt, failureText, zone } from "./format";
import { draftOf, LineEditor, readLine, type LineDraft } from "./line-editor";

interface Draft {
  clientId: string;
  issueDate: string;
  dueDate: string;
  validUntil: string;
  serviceDate: string;
  serviceEnd: string;
  nature: Nature;
  deliveryAddress: string;
  notes: string;
  lines: LineDraft[];
}

function draftFrom(doc: SalesDoc, locale: "fr" | "en"): Draft {
  const c = doc.content;
  return {
    clientId: c.clientId ?? "",
    issueDate: c.issueDate,
    dueDate: c.dueDate ?? "",
    validUntil: c.validUntil ?? "",
    serviceDate: c.serviceDate ?? "",
    serviceEnd: c.serviceEnd ?? "",
    nature: c.nature,
    deliveryAddress: c.deliveryAddress ?? "",
    notes: c.notes ?? "",
    lines: c.lines.map((l) => draftOf(l, locale)),
  };
}

/** What is sent to the server: empty dates left out, numbers read. */
function contentOf(d: Draft, kind: SalesDoc["kind"]): DocContent {
  const opt = (s: string) => (s.trim() ? s : undefined);
  return {
    clientId: d.clientId || null,
    issueDate: d.issueDate,
    dueDate: kind === "invoice" ? opt(d.dueDate) : undefined,
    validUntil: kind === "quote" ? opt(d.validUntil) : undefined,
    serviceDate: opt(d.serviceDate),
    serviceEnd: opt(d.serviceEnd),
    nature: d.nature,
    deliveryAddress: opt(d.deliveryAddress),
    notes: opt(d.notes),
    lines: d.lines.map((l) => readLine(l).line),
  };
}

/**
 * A draft quote, invoice or credit note: the form on one side, the sheet as
 * it will be printed on the other, and what still blocks issuing — checked
 * as it is typed, with the same rules the server applies.
 */
export function DocEditor({ doc, issuer, clients, catalog }: { doc: SalesDoc; issuer: Issuer | null; clients: Client[]; catalog: CatalogItem[] }) {
  const t = useMessages().sales;
  const e = t.editor;
  const locale = useLocale();
  const router = useRouter();
  const [d, setD] = useState<Draft>(() => draftFrom(doc, locale));
  const [saved, setSaved] = useState(() => JSON.stringify(draftFrom(doc, locale)));
  const [busy, setBusy] = useState<"save" | "issue" | "delete" | null>(null);
  const [dialog, setDialog] = useState<"issue" | "delete" | "client" | null>(null);
  const [serverProblems, setServerProblems] = useState<Problem[] | null>(null);
  const [known, setKnown] = useState(clients);

  const dirty = JSON.stringify(d) !== saved;
  const franchise = issuer?.vatRegime === "franchise";
  // Where the draft comes from is kept by the server; the preview shows it too.
  const content = useMemo(
    () => ({ ...contentOf(d, doc.kind), relatedId: doc.content.relatedId, relatedNumber: doc.content.relatedNumber }),
    [d, doc.kind, doc.content.relatedId, doc.content.relatedNumber]
  );
  const totals = useMemo(() => totalsOf(content.lines, issuer?.vatRegime ?? "normal"), [content.lines, issuer?.vatRegime]);
  const client = known.find((c) => c.id === d.clientId) ?? null;
  const check = useMemo(() => checkBeforeIssue(doc.kind, content, issuer, client), [doc.kind, content, issuer, client]);
  const badLines = d.lines.some((l) => readLine(l).bad.length > 0);
  const active = known.filter((c) => !c.archived || c.id === d.clientId);
  const change = (next: (s: Draft) => Draft) => {
    setServerProblems(null);
    setD(next);
  };
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => change((s) => ({ ...s, [k]: v }));

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async (quiet = false): Promise<boolean> => {
    if (badLines) {
      toast(t.errors.invalid, "error");
      return false;
    }
    setBusy("save");
    const r = await attempt(() => saveDraftDocument(doc.id, content));
    setBusy(null);
    if (!r.ok) {
      toast(failureText(t, r), "error");
      if (r.code === "not_draft") router.refresh();
      return false;
    }
    setSaved(JSON.stringify(d));
    if (!quiet) toast(e.saved);
    return true;
  };

  const issue = async () => {
    if (dirty && !(await save(true))) return;
    setBusy("issue");
    const r = await attempt(() => issueDocument(doc.id, zone()));
    setBusy(null);
    setDialog(null);
    if (r.ok) {
      setSaved(JSON.stringify(d));
      toast(fill(e.issued, { number: r.data.number ?? "" }));
      router.refresh();
    } else if (r.code === "check" && r.problems) {
      setServerProblems(r.problems);
      toast(t.errors.check, "error");
    } else toast(failureText(t, r), "error");
  };

  const remove = async () => {
    setBusy("delete");
    const r = await attempt(() => deleteDraftDocument(doc.id));
    setBusy(null);
    if (r.ok) {
      setSaved(JSON.stringify(d));
      toast(e.deleted);
      router.push("/sales");
    } else {
      setDialog(null);
      toast(failureText(t, r), "error");
    }
  };

  // What the server found besides what the page sees, until the draft changes again.
  const problems = [...new Set([...check.problems, ...(serverProblems ?? [])])];

  return (
    <>
      <Link href="/sales" className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {e.back}
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">{fill(e.draftOf, { kind: t.kinds[doc.kind] })}</h1>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            {e.draftNote}
            {doc.content.relatedNumber && <> · {fill(doc.kind === "credit" ? e.onInvoice : e.related, { number: doc.content.relatedNumber })}</>}
          </p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 text-[0.75rem]", dirty ? "text-warning" : "text-muted")} aria-live="polite">
          {dirty ? <CircleAlert className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          {dirty ? e.unsaved : e.upToDate}
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label={e.client} wide>
              {(p) => (
                <div className="flex gap-2">
                  <select {...p} value={d.clientId} onChange={(ev) => set("clientId")(ev.target.value)} className={inputCls} disabled={doc.kind === "credit"}>
                    <option value="">{e.chooseClient}</option>
                    {active.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {doc.kind !== "credit" && (
                    <button type="button" onClick={() => setDialog("client")} aria-label={e.addClient} title={e.addClient} className={cn(buttonVariants({ variant: "secondary", size: "icon" }), "h-10 w-10 shrink-0 sm:h-9 sm:w-9")}>
                      <UserPlus className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              )}
            </Field>
            <Field label={e.issueDate}>{(p) => <input {...p} type="date" value={d.issueDate} onChange={(ev) => set("issueDate")(ev.target.value)} className={inputCls} />}</Field>
            {doc.kind === "invoice" && <Field label={e.dueDate}>{(p) => <input {...p} type="date" value={d.dueDate} onChange={(ev) => set("dueDate")(ev.target.value)} className={inputCls} />}</Field>}
            {doc.kind === "quote" && <Field label={e.validUntil}>{(p) => <input {...p} type="date" value={d.validUntil} onChange={(ev) => set("validUntil")(ev.target.value)} className={inputCls} />}</Field>}
            {doc.kind === "credit" && <span className="max-sm:hidden" />}
            <Field label={e.serviceDate}>{(p) => <input {...p} type="date" value={d.serviceDate} onChange={(ev) => set("serviceDate")(ev.target.value)} className={inputCls} />}</Field>
            <Field label={e.serviceEnd}>{(p) => <input {...p} type="date" value={d.serviceEnd} min={d.serviceDate || undefined} onChange={(ev) => set("serviceEnd")(ev.target.value)} className={inputCls} />}</Field>
            <Field label={e.nature} wide>
              {(p) => (
                <select {...p} value={d.nature} onChange={(ev) => set("nature")(ev.target.value as Nature)} className={inputCls}>
                  {NATURES.map((n) => (
                    <option key={n} value={n}>
                      {e.natures[n]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {d.nature !== "services" && (
              <Field label={e.deliveryAddress} wide>{(p) => <input {...p} value={d.deliveryAddress} onChange={(ev) => set("deliveryAddress")(ev.target.value)} className={inputCls} />}</Field>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-[0.875rem] font-semibold">{e.lines}</h2>
            <LineEditor lines={d.lines} onChange={(lines) => change((s) => ({ ...s, lines }))} catalog={catalog} franchise={franchise} />
          </Card>

          <Card className="p-4">
            <Field label={e.notes}>{(p) => <textarea {...p} rows={3} value={d.notes} onChange={(ev) => set("notes")(ev.target.value)} className={areaCls} />}</Field>
          </Card>

          {(problems.length > 0 || check.warnings.length > 0) && (
            <Card className="p-4" aria-live="polite">
              <h2 className="mb-2 text-[0.875rem] font-semibold">{e.before}</h2>
              <ul className="space-y-1.5 text-[0.8125rem]">
                {problems.map((p) => (
                  <li key={p} className="flex gap-2 text-danger">
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {p === "issuer_missing" ? (
                      <Link href="/sales?tab=business" className="underline underline-offset-2">
                        {t.problems[p]}
                      </Link>
                    ) : (
                      t.problems[p]
                    )}
                  </li>
                ))}
                {check.warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t.warnings[w]}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/95 p-2 shadow-card backdrop-blur">
            <button type="button" onClick={() => setDialog("delete")} disabled={busy !== null} aria-label={e.delete} title={e.delete} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "hover:text-danger")}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => save()} disabled={busy !== null || !dirty} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-auto")}>
              {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {busy === "save" ? t.saving : t.save}
            </button>
            <button type="button" onClick={() => setDialog("issue")} disabled={busy !== null || problems.length > 0 || badLines} className={buttonVariants({ size: "sm" })}>
              <Send className="h-3.5 w-3.5" aria-hidden />
              {e.issue}
            </button>
          </div>
        </div>

        <div className="min-w-0">
          <DocSheet kind={doc.kind} number={null} content={content} totals={totals} issuer={issuer} client={client} />
          {franchise && <p className="mt-2 text-center text-[0.75rem] text-muted">{e.franchise}</p>}
        </div>
      </div>

      <Modal open={dialog === "issue"} onClose={() => setDialog(null)} title={fill(e.issueTitle, { kind: t.kinds[doc.kind].toLowerCase() })} closeLabel={t.close}>
        <div className="space-y-4 p-5">
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">{e.issueBody}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t.cancel}
            </button>
            <button type="button" onClick={issue} disabled={busy !== null} className={buttonVariants({ size: "sm" })} data-autofocus>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
              {e.issueConfirm}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={dialog === "delete"} onClose={() => setDialog(null)} title={e.deleteTitle} closeLabel={t.close}>
        <div className="space-y-4 p-5">
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">{e.deleteBody}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className={buttonVariants({ variant: "ghost", size: "sm" })} data-autofocus>
              {t.cancel}
            </button>
            <button type="button" onClick={remove} disabled={busy !== null} className={cn(buttonVariants({ size: "sm" }), "bg-danger text-white hover:bg-danger/90")}>
              {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
              {e.delete}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={dialog === "client"} onClose={() => setDialog(null)} title={t.clients.newTitle} closeLabel={t.close} wide>
        {dialog === "client" && (
          <ClientForm
            client={null}
            onCancel={() => setDialog(null)}
            onSaved={(c) => {
              setKnown((k) => [...k, c]);
              set("clientId")(c.id);
              setDialog(null);
            }}
          />
        )}
      </Modal>
    </>
  );
}
