"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { locked } from "@/lib/plans/server";
import { isValidZone, wallTime } from "@/lib/reminders/zoned";
import { balanceOf, totalsOf, type Payment } from "@/lib/sales/compute";
import { checkBeforeIssue, type Problem, type Warning } from "@/lib/sales/legal";
import { addDays, catalogSchema, clientSchema, contentSchema, issuerSchema, paymentSchema, type Client, type ClientSnapshot, type DocContent, type DocKind, type Issuer, type SalesDoc } from "@/lib/sales/model";
import { getSalesStore } from "@/lib/sales/store";

/**
 * Quotes, invoices and credit notes, as actions: a signed-in person, the
 * edition that opens invoicing, migration 017 in place, every input checked
 * here. The store keeps the numbering and frozen documents; these actions
 * add what must be true before a document is issued.
 */

export type SalesCode = "unauthorized" | "edition" | "migration_pending" | "invalid" | "not_found" | "not_draft" | "not_issued" | "check" | "too_much" | "failed";
export type SalesResult<T> = { ok: true; data: T } | { ok: false; code: SalesCode; problems?: Problem[]; warnings?: Warning[]; field?: string };

const fail = (code: SalesCode, extra: { problems?: Problem[]; warnings?: Warning[]; field?: string } = {}): SalesResult<never> => ({ ok: false, code, ...extra });
const idSchema = z.string().trim().min(1).max(64);

async function actor(): Promise<string | SalesResult<never>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  if (await locked("invoicing")) return fail("edition");
  if (!(await getSalesStore().supports())) return fail("migration_pending");
  return userKey;
}

function failure(err: unknown): SalesResult<never> {
  console.error("[sales]", err instanceof Error ? err.message : err);
  return fail("failed");
}

const refresh = (docId?: string) => {
  revalidatePath("/sales");
  if (docId) revalidatePath(`/sales/${docId}`);
};

/** Today on the person's clock (YYYY-MM-DD). */
function today(zone: unknown): string {
  const w = wallTime(new Date(), isValidZone(zone) ? (zone as string) : "Europe/Paris");
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

const snapshotOf = (c: Client): ClientSnapshot => ({ kind: c.kind, name: c.name, contact: c.contact, email: c.email, address: c.address, siren: c.siren, vatNumber: c.vatNumber });
const regimeOf = (issuer: Issuer | null) => issuer?.vatRegime ?? "normal";
const fieldOf = (e: z.ZodError) => String(e.issues[0]?.path.join(".") || e.issues[0]?.message || "");

/* ── The business ─────────────────────────────────────────────────── */

export async function saveIssuer(input: unknown): Promise<SalesResult<null>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const parsed = issuerSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", { field: fieldOf(parsed.error) });
  try {
    await getSalesStore().saveIssuer(a, parsed.data as Issuer);
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── Clients and catalogue ────────────────────────────────────────── */

export async function saveClient(clientId: unknown, input: unknown): Promise<SalesResult<Client>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = clientId === null ? null : idSchema.safeParse(clientId);
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success || (target && !target.success)) return fail("invalid", parsed.success ? {} : { field: fieldOf(parsed.error) });
  try {
    const c = await getSalesStore().saveClient(a, target ? (target.success ? target.data : null) : null, parsed.data);
    if (!c) return fail("not_found");
    refresh();
    return { ok: true, data: c };
  } catch (err) {
    return failure(err);
  }
}

export async function archiveClient(clientId: unknown, archived: unknown): Promise<SalesResult<null>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(clientId);
  if (!target.success || typeof archived !== "boolean") return fail("invalid");
  try {
    if (!(await getSalesStore().setClientArchived(a, target.data, archived))) return fail("not_found");
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function saveCatalogItem(itemId: unknown, input: unknown): Promise<SalesResult<null>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = itemId === null ? null : idSchema.safeParse(itemId);
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success || (target && !target.success)) return fail("invalid");
  try {
    const item = await getSalesStore().saveCatalogItem(a, target && target.success ? target.data : null, parsed.data);
    if (!item) return fail("not_found");
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function archiveCatalogItem(itemId: unknown, archived: unknown): Promise<SalesResult<null>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(itemId);
  if (!target.success || typeof archived !== "boolean") return fail("invalid");
  try {
    if (!(await getSalesStore().setCatalogArchived(a, target.data, archived))) return fail("not_found");
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── Drafts ───────────────────────────────────────────────────────── */

export async function createDocument(kind: unknown, clientId: unknown, zone: unknown): Promise<SalesResult<{ id: string }>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const k = z.enum(["quote", "invoice"]).safeParse(kind);
  if (!k.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const issuer = await store.getIssuer(a);
    const client = typeof clientId === "string" ? await store.getClient(a, clientId) : null;
    const day = today(zone);
    const content: DocContent = {
      clientId: client?.id ?? null,
      issueDate: day,
      ...(k.data === "invoice" ? { dueDate: addDays(day, issuer?.paymentDays ?? 30), serviceDate: day } : { validUntil: addDays(day, issuer?.quoteValidityDays ?? 30) }),
      nature: "services",
      lines: [],
    };
    const doc = await store.createDraft(a, k.data, content, totalsOf([], regimeOf(issuer)));
    refresh();
    return { ok: true, data: { id: doc.id } };
  } catch (err) {
    return failure(err);
  }
}

export async function saveDraftDocument(docId: unknown, input: unknown): Promise<SalesResult<SalesDoc>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  const parsed = contentSchema.safeParse(input);
  if (!target.success || !parsed.success) return fail("invalid", parsed.success ? {} : { field: fieldOf(parsed.error) });
  try {
    const store = getSalesStore();
    const doc = await store.getDoc(a, target.data);
    if (!doc) return fail("not_found");
    if (doc.number !== null) return fail("not_draft");
    if (parsed.data.clientId && !(await store.getClient(a, parsed.data.clientId))) return fail("invalid", { field: "clientId" });
    // What a draft cannot change: where it comes from.
    const content: DocContent = { ...parsed.data, relatedId: doc.content.relatedId, relatedNumber: doc.content.relatedNumber };
    const saved = await store.saveDraft(a, doc.id, content, totalsOf(content.lines, regimeOf(await store.getIssuer(a))));
    if (typeof saved === "string") return fail(saved === "missing" ? "not_found" : "not_draft");
    refresh(doc.id);
    return { ok: true, data: saved };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteDraftDocument(docId: unknown): Promise<SalesResult<null>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  if (!target.success) return fail("invalid");
  try {
    const r = await getSalesStore().deleteDraft(a, target.data);
    if (r !== true) return fail(r === "missing" ? "not_found" : "not_draft");
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/* ── Issuing ──────────────────────────────────────────────────────── */

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Issues a draft. It is dated the day it is issued, so numbers and dates
 * run in the same order; its due date or validity keeps the same delay.
 * It takes a copy of the client and of the business as they are now.
 */
export async function issueDocument(docId: unknown, zone: unknown): Promise<SalesResult<SalesDoc>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  if (!target.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const doc = await store.getDoc(a, target.data);
    if (!doc) return fail("not_found");
    if (doc.number !== null) return fail("not_draft");
    const [issuer, client] = await Promise.all([store.getIssuer(a), doc.content.clientId ? store.getClient(a, doc.content.clientId) : Promise.resolve(null)]);
    const day = today(zone);
    const shift = (d?: string) => (d ? addDays(day, daysBetween(doc.content.issueDate, d)) : undefined);
    const content: DocContent = {
      ...doc.content,
      issueDate: day,
      dueDate: shift(doc.content.dueDate),
      validUntil: shift(doc.content.validUntil),
    };
    const { problems, warnings } = checkBeforeIssue(doc.kind, content, issuer, client);
    if (problems.length) return fail("check", { problems, warnings });
    const frozen: DocContent = { ...content, client: snapshotOf(client as Client), issuer: issuer as Issuer };
    const issued = await store.issue(a, doc.id, frozen, totalsOf(frozen.lines, regimeOf(issuer)), Number(day.slice(0, 4)));
    if (typeof issued === "string") return fail(issued === "missing" ? "not_found" : "not_draft");
    if (issued.kind === "credit" && issued.content.relatedId) await settleCredited(a, issued.content.relatedId);
    refresh(doc.id);
    return { ok: true, data: issued };
  } catch (err) {
    return failure(err);
  }
}

/** An invoice whose credit notes cover all of it is cancelled. */
async function settleCredited(userKey: string, invoiceId: string): Promise<void> {
  const store = getSalesStore();
  const invoice = await store.getDoc(userKey, invoiceId);
  if (!invoice || invoice.kind !== "invoice" || invoice.number === null) return;
  const credited = (await store.listDocs(userKey))
    .filter((d) => d.kind === "credit" && d.number !== null && d.content.relatedId === invoiceId)
    .reduce((s, d) => s + d.totals.grossCents, 0);
  if (credited >= invoice.totals.grossCents) await store.setState(userKey, invoiceId, "cancelled");
}

/* ── After issuing ────────────────────────────────────────────────── */

/** A sent quote, accepted or declined by the client (or back to open). */
export async function markQuote(docId: unknown, state: unknown): Promise<SalesResult<null>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  const s = z.enum(["open", "accepted", "declined"]).safeParse(state);
  if (!target.success || !s.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const doc = await store.getDoc(a, target.data);
    if (!doc || doc.kind !== "quote") return fail("not_found");
    if (doc.number === null || doc.state === "invoiced") return fail("not_issued");
    await store.setState(a, doc.id, s.data);
    refresh(doc.id);
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

/** A new draft from an issued document: an invoice from a quote, a credit note from an invoice. */
async function draftFrom(userKey: string, source: SalesDoc, kind: DocKind, zone: unknown): Promise<string> {
  const store = getSalesStore();
  const issuer = await store.getIssuer(userKey);
  const day = today(zone);
  const content: DocContent = {
    clientId: source.content.clientId,
    issueDate: day,
    ...(kind === "invoice" ? { dueDate: addDays(day, issuer?.paymentDays ?? 30), serviceDate: source.content.serviceDate ?? day } : {}),
    ...(kind === "credit" ? { serviceDate: source.content.serviceDate } : {}),
    serviceEnd: source.content.serviceEnd,
    nature: source.content.nature,
    deliveryAddress: source.content.deliveryAddress,
    lines: source.content.lines.map((l) => ({ ...l, id: randomUUID() })),
    relatedId: source.id,
    relatedNumber: source.number ?? undefined,
  };
  const doc = await store.createDraft(userKey, kind, content, totalsOf(content.lines, regimeOf(issuer)));
  return doc.id;
}

/** An accepted (or sent) quote becomes an invoice draft; the quote is marked invoiced. */
export async function convertQuote(docId: unknown, zone: unknown): Promise<SalesResult<{ id: string }>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  if (!target.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const quote = await store.getDoc(a, target.data);
    if (!quote || quote.kind !== "quote") return fail("not_found");
    if (quote.number === null || quote.state === "invoiced" || quote.state === "declined") return fail("not_issued");
    const invoiceId = await draftFrom(a, quote, "invoice", zone);
    await store.setState(a, quote.id, "invoiced");
    refresh(quote.id);
    return { ok: true, data: { id: invoiceId } };
  } catch (err) {
    return failure(err);
  }
}

/** An issued invoice is never deleted: it is cancelled by a credit note, drafted here for the whole amount. */
export async function creditInvoice(docId: unknown, zone: unknown): Promise<SalesResult<{ id: string }>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  if (!target.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const invoice = await store.getDoc(a, target.data);
    if (!invoice || invoice.kind !== "invoice") return fail("not_found");
    if (invoice.number === null || invoice.state === "cancelled") return fail("not_issued");
    const creditId = await draftFrom(a, invoice, "credit", zone);
    refresh(invoice.id);
    return { ok: true, data: { id: creditId } };
  } catch (err) {
    return failure(err);
  }
}

/** A new draft with the same lines, client and nature — for a document like an earlier one. */
export async function duplicateDocument(docId: unknown, zone: unknown): Promise<SalesResult<{ id: string }>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  if (!target.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const source = await store.getDoc(a, target.data);
    if (!source || source.kind === "credit") return fail("not_found");
    const id = await draftFrom(a, source, source.kind, zone);
    // A copy is new work, not a follow-up: it points to nothing.
    const copy = await store.getDoc(a, id);
    if (copy) await store.saveDraft(a, id, { ...copy.content, relatedId: undefined, relatedNumber: undefined }, copy.totals);
    refresh();
    return { ok: true, data: { id } };
  } catch (err) {
    return failure(err);
  }
}

/* ── Payments ─────────────────────────────────────────────────────── */

/**
 * A payment received on an issued invoice — never more than what is still
 * owed. It is also written to the finances as income, on its real day, so
 * the treasury and the runway count it; removing the payment removes it.
 */
export async function recordPayment(docId: unknown, input: unknown): Promise<SalesResult<SalesDoc>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  const parsed = paymentSchema.safeParse(input);
  if (!target.success || !parsed.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const doc = await store.getDoc(a, target.data);
    if (!doc || doc.kind !== "invoice") return fail("not_found");
    if (doc.number === null || doc.state === "cancelled") return fail("not_issued");
    if (parsed.data.amountCents > balanceOf(doc.totals, doc.payments)) return fail("too_much");

    let transactionId: string | null = null;
    const data = getStore();
    try {
      const dated = await data.supportsFounder();
      const txn = await data.insert(a, "transactions", {
        item: `${doc.number} — ${doc.content.client?.name ?? ""}`.trim(),
        type: "Income",
        amount: parsed.data.amountCents / 100,
        category: "Ventes",
        date: parsed.data.date,
        ...(dated ? { occurredOn: parsed.data.date } : {}),
      });
      transactionId = txn.id;
    } catch (err) {
      // The payment counts on the invoice even if the finances could not take it.
      console.error("[sales] income not recorded", err instanceof Error ? err.message : err);
    }
    const payment: Payment = { id: randomUUID(), ...parsed.data, transactionId };
    const saved = await store.setPayments(a, doc.id, [...doc.payments, payment]);
    if (saved === "missing") return fail("not_found");
    refresh(doc.id);
    revalidatePath("/finance");
    return { ok: true, data: saved };
  } catch (err) {
    return failure(err);
  }
}

export async function removePayment(docId: unknown, paymentId: unknown): Promise<SalesResult<SalesDoc>> {
  const a = await actor();
  if (typeof a !== "string") return a;
  const target = idSchema.safeParse(docId);
  const pid = idSchema.safeParse(paymentId);
  if (!target.success || !pid.success) return fail("invalid");
  try {
    const store = getSalesStore();
    const doc = await store.getDoc(a, target.data);
    if (!doc || doc.kind !== "invoice") return fail("not_found");
    const payment = doc.payments.find((p) => p.id === pid.data);
    if (!payment) return fail("not_found");
    if (payment.transactionId) await getStore().remove(a, "transactions", payment.transactionId).catch(() => undefined);
    const saved = await store.setPayments(a, doc.id, doc.payments.filter((p) => p.id !== pid.data));
    if (saved === "missing") return fail("not_found");
    refresh(doc.id);
    revalidatePath("/finance");
    return { ok: true, data: saved };
  } catch (err) {
    return failure(err);
  }
}