import "server-only";
import { randomUUID } from "node:crypto";
import { locked } from "@/lib/plans/server";
import { formatCents, formatRate, totalsOf, type Line } from "./compute";
import { addDays, type DocContent } from "./model";
import { figuresOf, parisToday, rowsOf } from "./overview";
import { getSalesStore } from "./store";

/**
 * Sales as the agent sees them: it reads the figures, the documents, the
 * clients and the catalogue, and it prepares drafts. It never issues — an
 * issued invoice is a legal document that can never be deleted, so giving
 * it a number stays the owner's act, on the page.
 */

export type SalesAgentResult = { ok: true; detail: string; data: string } | { ok: false; error: string };

async function ready(): Promise<string | null> {
  if (await locked("invoicing")) return "Sales are not part of the owner's edition.";
  if (!(await getSalesStore().supports())) return "Sales need database migration 017 — nothing to read yet.";
  return null;
}

export async function salesOverview(userKey: string): Promise<SalesAgentResult> {
  const blocked = await ready();
  if (blocked) return { ok: false, error: blocked };
  const store = getSalesStore();
  const [issuer, clients, catalog, docs] = await Promise.all([store.getIssuer(userKey), store.listClients(userKey), store.listCatalog(userKey), store.listDocs(userKey)]);
  const today = parisToday();
  const rows = rowsOf(docs, clients, today);
  const f = figuresOf(rows, docs, today);
  const eur = (c: number) => formatCents(c, "en");
  const out = [
    `Sales on ${today} (amounts in euros${issuer?.vatRegime === "franchise" ? "; the business is exempt from VAT" : ""}).`,
    issuer ? `Business: ${issuer.legalName}.` : "The business is not filled in yet: no document can be issued until the owner fills in “My business”.",
    `Still owed: ${eur(f.outstanding.cents)} on ${f.outstanding.count} invoice(s). Overdue: ${eur(f.overdue.cents)} on ${f.overdue.count}. Invoiced in ${f.invoicedYear.year}: ${eur(f.invoicedYear.netCents)} excl. VAT, credit notes deducted. Quotes awaiting an answer: ${f.quotesOpen.count} for ${eur(f.quotesOpen.cents)}.`,
    "",
    `Documents (${rows.length}, newest first, at most 40):`,
    ...rows.slice(0, 40).map((r) => `- ${r.number ?? `draft ${r.kind}`} [${r.id}] · ${r.status} · ${r.clientName ?? "no client"} · ${r.issueDate} · ${eur(r.grossCents)} incl. VAT${r.balanceCents ? ` · owed ${eur(r.balanceCents)}` : ""}${r.dueDate && r.kind === "invoice" ? ` · due ${r.dueDate}` : ""}`),
    "",
    `Clients (${clients.filter((c) => !c.archived).length}):`,
    ...clients.filter((c) => !c.archived).slice(0, 60).map((c) => `- ${c.name} [${c.id}] · ${c.kind}${c.address.city ? ` · ${c.address.city}` : ""}`),
    "",
    `Catalogue (${catalog.filter((c) => !c.archived).length}):`,
    ...catalog.filter((c) => !c.archived).slice(0, 60).map((c) => `- ${c.name} [${c.id}] · ${eur(c.unitPriceCents)} excl. VAT per ${c.unit} · VAT ${formatRate(c.vatBp, "en")}`),
  ];
  return { ok: true, detail: `Read ${rows.length} sales documents.`, data: out.join("\n") };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * A draft quote or invoice, from what the agent was asked: a client of the
 * directory, lines typed or taken from the catalogue. Every amount is checked
 * here; anything unclear is refused rather than guessed.
 */
export async function createSalesDraft(userKey: string, payload: Record<string, unknown>): Promise<SalesAgentResult> {
  const blocked = await ready();
  if (blocked) return { ok: false, error: blocked };
  const kind = payload.document === "quote" || payload.document === "invoice" ? payload.document : null;
  if (!kind) return { ok: false, error: "document must be \"quote\" or \"invoice\"." };
  const store = getSalesStore();
  const [issuer, catalog] = await Promise.all([store.getIssuer(userKey), store.listCatalog(userKey)]);

  const clientId = text(payload.clientId, 64) || null;
  const client = clientId ? await store.getClient(userKey, clientId) : null;
  if (clientId && !client) return { ok: false, error: `No client has the id ${clientId}: read sales_overview for the ids.` };

  const raw = Array.isArray(payload.lines) ? payload.lines.slice(0, 50) : [];
  if (raw.length === 0) return { ok: false, error: "A draft needs at least one line." };
  const lines: Line[] = [];
  for (const [i, r] of raw.entries()) {
    const l = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const item = l.catalogId ? catalog.find((c) => c.id === l.catalogId && !c.archived) : undefined;
    if (l.catalogId && !item) return { ok: false, error: `Line ${i + 1}: no catalogue item has the id ${String(l.catalogId)}.` };
    const quantity = l.quantity === undefined ? 1 : num(l.quantity);
    const euros = l.unitPriceEuros === undefined ? (item ? item.unitPriceCents / 100 : NaN) : num(l.unitPriceEuros);
    const vat = l.vatRate === undefined ? (item ? item.vatBp / 100 : 20) : num(l.vatRate);
    const discount = l.discountPercent === undefined ? 0 : num(l.discountPercent);
    const description = text(l.description, 2000) || [item?.name, item?.description].filter(Boolean).join("\n");
    if (!description) return { ok: false, error: `Line ${i + 1} needs a description.` };
    if (!(quantity > 0 && quantity <= 1e6)) return { ok: false, error: `Line ${i + 1}: the quantity must be above 0.` };
    if (!(euros >= 0 && euros <= 1e10)) return { ok: false, error: `Line ${i + 1}: give the unit price excluding VAT, in euros.` };
    if (!(vat >= 0 && vat <= 100)) return { ok: false, error: `Line ${i + 1}: the VAT rate is a percentage (20, 10, 5.5, 2.1 or 0).` };
    if (!(discount >= 0 && discount <= 100)) return { ok: false, error: `Line ${i + 1}: the discount is a percentage.` };
    lines.push({
      id: randomUUID(),
      description,
      quantity: Math.round(quantity * 1000) / 1000,
      unit: text(l.unit, 30) || item?.unit || "unité",
      unitPriceCents: Math.round(euros * 100),
      vatBp: Math.round(vat * 100),
      discountBp: Math.round(discount * 100),
    });
  }

  const day = parisToday();
  const content: DocContent = {
    clientId: client?.id ?? null,
    issueDate: day,
    ...(kind === "invoice" ? { dueDate: addDays(day, issuer?.paymentDays ?? 30), serviceDate: day } : { validUntil: addDays(day, issuer?.quoteValidityDays ?? 30) }),
    nature: payload.nature === "goods" || payload.nature === "mixed" ? payload.nature : "services",
    lines,
    notes: text(payload.notes, 4000) || undefined,
  };
  const totals = totalsOf(lines, issuer?.vatRegime ?? "normal");
  const doc = await store.createDraft(userKey, kind, content, totals);
  const eur = (c: number) => formatCents(c, "en");
  return {
    ok: true,
    detail: `Drafted ${kind === "invoice" ? "an invoice" : "a quote"} for ${eur(totals.grossCents)} — not issued.`,
    data: [
      `Draft ${kind} created [${doc.id}], at /sales/${doc.id}: ${lines.length} line(s), ${eur(totals.netCents)} excl. VAT, ${eur(totals.grossCents)} incl. VAT${client ? `, for ${client.name}` : ", no client chosen yet"}.`,
      "It has no number yet: the owner checks it and issues it from the page. Tell them so, with the link.",
      issuer ? "" : "The business is not filled in yet (“My business”): it must be before the draft can be issued.",
    ].filter(Boolean).join("\n"),
  };
}
