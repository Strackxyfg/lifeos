import { balanceOf, formatRate, paidOf } from "./compute";
import type { SalesDoc } from "./model";

/**
 * The sales journal of a year, for the accountant: every issued invoice and
 * credit note, in the order of their dates and numbers, with the base and
 * the VAT of each rate, the totals, what was paid and what is still owed.
 *
 * Credit notes count negative, as they reduce the year's sales. Quotes are
 * not accounting documents and are left out. The file is the French
 * spreadsheet convention — semicolons, decimal commas, a byte-order mark so
 * Excel reads the accents — and amounts are exact: cents, never rounded twice.
 *
 * It is a journal to hand over, not a FEC: a FEC holds every entry of the
 * business, which LifeOS does not keep.
 */

const SEP = ";";

/** "1234,56" — no grouping, so a spreadsheet reads it as a number. */
const amount = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
};

/** A cell, quoted when it holds the separator, a quote or a line break. */
const cell = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const STATUS_FR = { cancelled: "Annulée", paid: "Payée", partial: "Payée en partie", open: "À encaisser" } as const;

export function salesJournal(docs: SalesDoc[], year: number): { filename: string; csv: string; count: number } {
  const rows = docs
    .filter((d) => d.number !== null && (d.kind === "invoice" || d.kind === "credit") && d.content.issueDate.startsWith(`${year}-`))
    .sort((a, b) => a.content.issueDate.localeCompare(b.content.issueDate) || (a.number ?? "").localeCompare(b.number ?? ""));

  // One base and one VAT column per rate used in the year, highest first.
  const rates = [...new Set(rows.flatMap((d) => d.totals.bands.map((b) => b.vatBp)))].sort((a, b) => b - a);
  const header = [
    "Date",
    "Numéro",
    "Type",
    "Client",
    "SIREN client",
    "N° TVA client",
    ...rates.flatMap((r) => [`Base HT ${formatRate(r)}`, `TVA ${formatRate(r)}`]),
    "Total HT",
    "Total TVA",
    "Total TTC",
    "Payé",
    "Reste dû",
    "Échéance",
    "Statut",
    "Pièce liée",
  ];

  const lines = rows.map((d) => {
    const sign = d.kind === "credit" ? -1 : 1;
    const band = (r: number) => d.totals.bands.find((b) => b.vatBp === r);
    const client = d.content.client;
    const invoice = d.kind === "invoice";
    const owed = invoice && d.state !== "cancelled" ? balanceOf(d.totals, d.payments) : 0;
    const status = !invoice ? "Émis" : d.state === "cancelled" ? STATUS_FR.cancelled : owed === 0 ? STATUS_FR.paid : paidOf(d.payments) > 0 ? STATUS_FR.partial : STATUS_FR.open;
    return [
      d.content.issueDate,
      d.number ?? "",
      invoice ? "Facture" : "Avoir",
      client?.name ?? "",
      client?.siren ?? "",
      client?.vatNumber ?? "",
      ...rates.flatMap((r) => {
        const b = band(r);
        return b ? [amount(sign * b.baseCents), amount(sign * b.vatCents)] : ["", ""];
      }),
      amount(sign * d.totals.netCents),
      amount(sign * d.totals.vatCents),
      amount(sign * d.totals.grossCents),
      invoice ? amount(paidOf(d.payments)) : "",
      invoice ? amount(owed) : "",
      d.content.dueDate ?? "",
      status,
      d.content.relatedNumber ?? "",
    ];
  });

  // Totals of the year, credit notes deducted.
  const sum = (f: (d: SalesDoc) => number) => rows.reduce((s, d) => s + (d.kind === "credit" ? -1 : 1) * f(d), 0);
  const total = [
    "",
    "",
    "Total",
    "",
    "",
    "",
    ...rates.flatMap((r) => [amount(sum((d) => d.totals.bands.find((b) => b.vatBp === r)?.baseCents ?? 0)), amount(sum((d) => d.totals.bands.find((b) => b.vatBp === r)?.vatCents ?? 0))]),
    amount(sum((d) => d.totals.netCents)),
    amount(sum((d) => d.totals.vatCents)),
    amount(sum((d) => d.totals.grossCents)),
    "",
    "",
    "",
    "",
    "",
  ];

  const csv = "\uFEFF" + [header, ...lines, ...(rows.length ? [total] : [])].map((l) => l.map(cell).join(SEP)).join("\r\n") + "\r\n";
  return { filename: `journal-des-ventes-${year}.csv`, csv, count: rows.length };
}
