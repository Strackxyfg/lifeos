import { balanceOf, paidOf } from "./compute";
import { isFrenchVat, isEuVat, isSiren, isSiret } from "./identifiers";
import type { Client, ClientSnapshot, DocContent, DocKind, Issuer, SalesDoc } from "./model";

/**
 * What French law asks of a quote, an invoice and a credit note, and what a
 * document must hold before it can be issued.
 *
 * The mentions follow the Code de commerce (art. L441-9, L441-10, D441-5)
 * and the Code général des impôts (art. 242 nonies A of annex II), with the
 * mentions the electronic-invoicing reform adds — the client's SIREN, the
 * nature of the operations, a delivery address that differs, the option for
 * VAT on debits — already in place. Documents are written in French, as the
 * law requires for invoices issued in France.
 *
 * This is the shape of a compliant document, not legal advice; an
 * accountant has the last word on a given business.
 */

/* ── Numbers ──────────────────────────────────────────────────────── */

export const PREFIX: Record<DocKind, string> = { quote: "DEV", invoice: "FAC", credit: "AV" };

/** "FAC-2026-0001": one continuous series per kind and per year. */
export function formatNumber(kind: DocKind, year: number, seq: number): string {
  return `${PREFIX[kind]}-${year}-${String(seq).padStart(4, "0")}`;
}

export function parseNumber(n: string): { kind: DocKind; year: number; seq: number } | null {
  const m = n.match(/^(DEV|FAC|AV)-(\d{4})-(\d{4,})$/);
  if (!m) return null;
  const kind = (Object.entries(PREFIX).find(([, p]) => p === m[1])?.[0] ?? "invoice") as DocKind;
  return { kind, year: Number(m[2]), seq: Number(m[3]) };
}

/* ── Status ───────────────────────────────────────────────────────── */

export type Status =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"
  | "invoiced"
  | "issued"
  | "partial"
  | "paid"
  | "overdue"
  | "cancelled";

/** Where a document stands today (`today`: YYYY-MM-DD on the owner's clock). */
export function statusOf(doc: Pick<SalesDoc, "kind" | "number" | "state" | "totals" | "payments" | "content">, today: string): Status {
  if (doc.number === null) return "draft";
  if (doc.kind === "quote") {
    if (doc.state === "invoiced") return "invoiced";
    if (doc.state === "accepted") return "accepted";
    if (doc.state === "declined") return "declined";
    if (doc.content.validUntil && doc.content.validUntil < today) return "expired";
    return "sent";
  }
  if (doc.kind === "credit") return "issued";
  if (doc.state === "cancelled") return "cancelled";
  if (balanceOf(doc.totals, doc.payments) === 0) return "paid";
  if (doc.content.dueDate && doc.content.dueDate < today) return "overdue";
  if (paidOf(doc.payments) > 0) return "partial";
  return "issued";
}

/* ── Before issuing ───────────────────────────────────────────────── */

export type Problem =
  | "issuer_missing"
  | "issuer_name"
  | "issuer_address"
  | "issuer_siren"
  | "issuer_vat"
  | "client_missing"
  | "client_name"
  | "client_address"
  | "no_lines"
  | "line_description"
  | "line_quantity"
  | "due_before_issue"
  | "service_date"
  | "valid_until"
  | "related_missing";

export type Warning = "client_siren" | "client_vat_eu" | "zero_total";

const hasAddress = (a?: { line1?: string; postalCode?: string; city?: string }) => Boolean(a?.line1?.trim() && a.postalCode?.trim() && a.city?.trim());

/** What blocks issuing (problems) and what deserves a look (warnings). */
export function checkBeforeIssue(kind: DocKind, content: DocContent, issuer: Issuer | null, client: Client | null): { problems: Problem[]; warnings: Warning[] } {
  const problems: Problem[] = [];
  const warnings: Warning[] = [];
  if (!issuer) problems.push("issuer_missing");
  else {
    if (!issuer.legalName.trim()) problems.push("issuer_name");
    if (!hasAddress(issuer.address)) problems.push("issuer_address");
    if (!isSiren(issuer.siren)) problems.push("issuer_siren");
    if (issuer.vatRegime === "normal" && !(issuer.vatNumber && isFrenchVat(issuer.vatNumber))) problems.push("issuer_vat");
  }
  if (!client) problems.push("client_missing");
  else {
    if (!client.name.trim()) problems.push("client_name");
    if (!hasAddress(client.address)) problems.push("client_address");
    if (client.kind === "company" && !(client.siren && (isSiren(client.siren) || isSiret(client.siren))) && client.address.country.trim().toLowerCase() === "france") warnings.push("client_siren");
    if (client.kind === "company" && client.address.country.trim().toLowerCase() !== "france" && !(client.vatNumber && isEuVat(client.vatNumber))) warnings.push("client_vat_eu");
  }
  if (content.lines.length === 0) problems.push("no_lines");
  if (content.lines.some((l) => !l.description.trim())) problems.push("line_description");
  if (content.lines.some((l) => !(l.quantity > 0))) problems.push("line_quantity");
  if (kind === "invoice") {
    if (!content.serviceDate) problems.push("service_date");
    if (content.dueDate && content.dueDate < content.issueDate) problems.push("due_before_issue");
  }
  if (kind === "quote" && (!content.validUntil || content.validUntil < content.issueDate)) problems.push("valid_until");
  if (kind === "credit" && !content.relatedId) problems.push("related_missing");
  if (content.lines.length && content.lines.every((l) => l.unitPriceCents === 0)) warnings.push("zero_total");
  return { problems, warnings };
}

/* ── Mentions ─────────────────────────────────────────────────────── */

const frDate = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }) : "");

const NATURE_FR = { services: "Prestations de services", goods: "Livraison de biens", mixed: "Livraison de biens et prestations de services" } as const;

/** The issuer's identity lines, as printed on every document. */
export function issuerLines(i: Issuer): string[] {
  const individual = i.form === "EI" || i.form === "EIRL" || i.form === "Micro-entreprise";
  const name = individual ? `${i.legalName} — Entrepreneur individuel (EI)` : i.form && i.form !== "Autre" ? `${i.legalName} — ${i.form}` : i.legalName;
  const capital = i.capitalCents !== undefined && !individual && i.form && !["Association", "Autre"].includes(i.form)
    ? `${i.form} au capital de ${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(i.capitalCents / 100)}`
    : null;
  return [
    name,
    i.tradeName ? `Nom commercial : ${i.tradeName}` : null,
    capital,
    i.address.line1,
    i.address.line2 ?? null,
    `${i.address.postalCode} ${i.address.city}${i.address.country && i.address.country !== "France" ? `, ${i.address.country}` : ""}`,
    i.siret ? `SIRET ${i.siret}` : `SIREN ${i.siren}`,
    i.registry ?? null,
    i.vatRegime === "normal" && i.vatNumber ? `N° TVA intracommunautaire ${i.vatNumber}` : null,
    i.email ?? null,
    i.phone ?? null,
  ].filter((x): x is string => Boolean(x && x.trim()));
}

export function clientLines(c: ClientSnapshot): string[] {
  return [
    c.name,
    c.contact ? `À l'attention de ${c.contact}` : null,
    c.address.line1,
    c.address.line2 ?? null,
    `${c.address.postalCode} ${c.address.city}${c.address.country && c.address.country !== "France" ? `, ${c.address.country}` : ""}`,
    c.siren ? `SIREN ${c.siren}` : null,
    c.vatNumber ? `N° TVA ${c.vatNumber}` : null,
  ].filter((x): x is string => Boolean(x && x.trim()));
}

/**
 * The legal mentions of a document, in French, in the order they are
 * printed below the totals.
 */
export function mentionsOf(doc: Pick<SalesDoc, "kind" | "number" | "content">, issuer: Issuer, client: ClientSnapshot | null): string[] {
  const c = doc.content;
  const b2b = client?.kind === "company";
  const out: string[] = [];
  out.push(`Nature des opérations : ${NATURE_FR[c.nature]}.`);
  if (c.serviceDate) out.push(c.serviceEnd && c.serviceEnd !== c.serviceDate ? `Période de réalisation : du ${frDate(c.serviceDate)} au ${frDate(c.serviceEnd)}.` : `Date de réalisation : ${frDate(c.serviceDate)}.`);
  if (c.deliveryAddress) out.push(`Adresse de livraison : ${c.deliveryAddress}.`);
  if (issuer.vatRegime === "franchise") out.push("TVA non applicable, art. 293 B du CGI.");
  else if (issuer.vatOnDebits) out.push("Option pour le paiement de la taxe d'après les débits.");
  if (doc.kind === "invoice") {
    if (c.dueDate) out.push(`Date d'échéance : ${frDate(c.dueDate)}.`);
    out.push("Pas d'escompte pour paiement anticipé.");
    out.push(`En cas de retard de paiement : pénalités au taux de ${issuer.latePenalty.replace(/\.$/, "").replace(/^./, (s) => s.toLowerCase())}.`);
    if (b2b) out.push("Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (art. L441-10 et D441-5 du Code de commerce).");
    if (c.relatedNumber) out.push(`Établie d'après le devis n° ${c.relatedNumber}.`);
  }
  if (doc.kind === "credit" && c.relatedNumber) out.push(`Avoir sur la facture n° ${c.relatedNumber}.`);
  if (doc.kind === "quote") {
    if (c.validUntil) out.push(`Devis valable jusqu'au ${frDate(c.validUntil)}.`);
    out.push("Bon pour accord : date, signature et mention « bon pour accord ».");
  }
  if (issuer.iban && doc.kind !== "credit") out.push(`Règlement par virement : IBAN ${issuer.iban}${issuer.bic ? ` — BIC ${issuer.bic}` : ""}.`);
  return out;
}

export const TITLE: Record<DocKind, string> = { quote: "Devis", invoice: "Facture", credit: "Avoir" };
export { frDate };
