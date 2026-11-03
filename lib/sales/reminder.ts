import { balanceOf, formatCents } from "./compute";
import { frDate } from "./legal";
import { formatIban } from "./identifiers";
import type { SalesDoc } from "./model";

/**
 * A payment reminder for an invoice, ready for the owner to send from their
 * own mailbox: what is owed, since when, how to pay — in French, like the
 * invoice. A first reminder is courteous; once the due date is more than
 * fifteen days past, it recalls the penalties and, between businesses, the
 * €40 recovery fee the invoice already states.
 *
 * LifeOS writes it; it never sends it. Nor is it a formal notice (mise en
 * demeure): that is a letter of its own, best sent by recorded delivery.
 */

export interface PaymentReminder {
  /** 1: courteous; 2: firm, more than 15 days late. */
  level: 1 | 2;
  daysLate: number;
  to: string | null;
  subject: string;
  body: string;
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The reminder for an issued, unpaid invoice; null when nothing is owed. */
export function reminderOf(doc: SalesDoc, today: string): PaymentReminder | null {
  if (doc.kind !== "invoice" || doc.number === null || doc.state === "cancelled") return null;
  const owed = balanceOf(doc.totals, doc.payments);
  if (owed === 0) return null;
  const issuer = doc.content.issuer;
  const client = doc.content.client;
  const due = doc.content.dueDate;
  const daysLate = due ? Math.max(0, days(due, today)) : 0;
  const level: 1 | 2 = daysLate > 15 ? 2 : 1;
  const eur = (c: number) => formatCents(c, "fr");
  const partial = owed < doc.totals.grossCents;

  const facts = [
    `Facture n° ${doc.number} du ${frDate(doc.content.issueDate)}`,
    `Montant TTC : ${eur(doc.totals.grossCents)}`,
    ...(partial ? [`Déjà réglé : ${eur(doc.totals.grossCents - owed)}`] : []),
    `Reste dû : ${eur(owed)}`,
    ...(due ? [`Échéance : ${frDate(due)}${daysLate > 0 ? ` (dépassée de ${daysLate} jour${daysLate > 1 ? "s" : ""})` : ""}`] : []),
  ].map((l) => `- ${l}`);

  const pay = issuer?.iban ? [`Vous pouvez régler par virement sur le compte suivant : IBAN ${formatIban(issuer.iban)}${issuer.bic ? ` — BIC ${issuer.bic}` : ""}, en indiquant le numéro de la facture.`] : [];

  const firm =
    level === 2
      ? [
          `Sans règlement de votre part, des pénalités de retard s'appliquent, au taux de ${(issuer?.latePenalty ?? "trois fois le taux d'intérêt légal").replace(/\.$/, "").replace(/^./, (s) => s.toLowerCase())}${client?.kind === "company" ? ", ainsi que l'indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce)" : ""}, comme le prévoit la facture.`,
        ]
      : [];

  const opening =
    level === 1
      ? daysLate > 0
        ? "Sauf erreur de notre part, la facture ci-dessous n'a pas encore été réglée, alors que son échéance est passée :"
        : "Nous nous permettons de vous rappeler la facture ci-dessous :"
      : // Only what LifeOS knows: it does not know whether an earlier reminder was sent.
        "La facture ci-dessous reste impayée alors que son échéance est dépassée :";

  const body = [
    client?.contact ? `Bonjour ${client.contact},` : "Bonjour,",
    "",
    opening,
    "",
    ...facts,
    "",
    ...(pay.length ? [...pay, ""] : []),
    ...(firm.length ? [...firm, ""] : []),
    level === 1
      ? "Si le règlement a été effectué entre-temps, merci de ne pas tenir compte de ce message. Nous restons à votre disposition pour toute question."
      : "Nous vous remercions de procéder au règlement dans les meilleurs délais, ou de nous contacter si une difficulté le retarde.",
    "",
    "Cordialement,",
    issuer?.tradeName ?? issuer?.legalName ?? "",
    ...(issuer?.email ? [issuer.email] : []),
    ...(issuer?.phone ? [issuer.phone] : []),
  ].join("\n");

  const subject = `${level === 1 ? "Rappel" : "Relance"} — facture n° ${doc.number}${daysLate > 0 ? ` échue le ${frDate(due)}` : ""}`;
  return { level, daysLate, to: client?.email ?? null, subject, body: body.trim() };
}

/** A mailto: address that opens the owner's own mailbox with the reminder written. */
export function mailtoOf(r: PaymentReminder): string {
  // The address stays readable (some mail apps do not decode %40); anything that could end it is encoded.
  return `mailto:${encodeURIComponent(r.to ?? "").replace(/%40/g, "@")}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.body)}`;
}
