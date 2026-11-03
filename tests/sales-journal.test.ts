import { describe, it, expect } from "vitest";
import { totalsOf, type Line, type Payment } from "@/lib/sales/compute";
import { salesJournal } from "@/lib/sales/journal";
import type { ClientSnapshot, DocKind, DocState, Issuer, SalesDoc } from "@/lib/sales/model";
import { mailtoOf, reminderOf } from "@/lib/sales/reminder";

/**
 * The sales journal handed to the accountant, and the payment reminder the
 * owner sends: exact amounts, credit notes deducted, the French spreadsheet
 * convention; a reminder only for what is owed, firmer once well past due.
 */

const issuer: Issuer = {
  legalName: "Atelier Ada",
  form: "SAS",
  address: { line1: "1 rue de l'Essai", postalCode: "75001", city: "Paris", country: "France" },
  siren: "123456782",
  vatRegime: "normal",
  vatNumber: "FR11123456782",
  iban: "FR7630006000011234567890189",
  bic: "BNPAFRPP",
  email: "compta@atelier.test",
  paymentDays: 30,
  latePenalty: "Trois fois le taux d'intérêt légal",
  quoteValidityDays: 30,
};
const company: ClientSnapshot = { kind: "company", name: "Client; Essai", contact: "Dominique", email: "dominique@client.test", address: { line1: "a", postalCode: "69002", city: "Lyon", country: "France" }, siren: "987654324" };
const line = (cents: number, vatBp: number, id = "l"): Line => ({ id, description: "x", quantity: 1, unit: "u", unitPriceCents: cents, vatBp, discountBp: 0 });

let n = 0;
function doc(kind: DocKind, number: string | null, lines: Line[], over: { issueDate?: string; dueDate?: string; state?: DocState; payments?: Payment[]; client?: ClientSnapshot; relatedNumber?: string } = {}): SalesDoc {
  n += 1;
  return {
    id: `d${n}`,
    kind,
    number,
    state: over.state ?? "open",
    content: { clientId: "c", issueDate: over.issueDate ?? "2026-03-10", dueDate: over.dueDate, nature: "services", lines, client: over.client ?? company, issuer, relatedNumber: over.relatedNumber },
    totals: totalsOf(lines, "normal"),
    payments: over.payments ?? [],
    issuedAt: number ? "2026-03-10T10:00:00Z" : null,
    createdAt: "2026-03-10T09:00:00Z",
    updatedAt: "2026-03-10T09:00:00Z",
  };
}

describe("the sales journal", () => {
  const docs = [
    doc("invoice", "FAC-2026-0002", [line(100_000, 2000), line(10_000, 550, "m")], { issueDate: "2026-04-01", dueDate: "2026-05-01", payments: [{ id: "p", date: "2026-04-20", amountCents: 50_000, method: "transfer" }] }),
    doc("invoice", "FAC-2026-0001", [line(50_000, 2000)], { issueDate: "2026-03-10", dueDate: "2026-04-09" }),
    doc("credit", "AV-2026-0001", [line(50_000, 2000)], { issueDate: "2026-04-15", relatedNumber: "FAC-2026-0001" }),
    doc("quote", "DEV-2026-0001", [line(999_900, 2000)]),
    doc("invoice", null, [line(1_000, 2000)]),
    doc("invoice", "FAC-2025-0040", [line(70_000, 2000)], { issueDate: "2025-12-30" }),
  ];
  const { csv, filename, count } = salesJournal(docs, 2026);
  const rows = csv.slice(1).trimEnd().split("\r\n");

  it("holds the year's issued invoices and credit notes, by date — no quote, no draft, no other year", () => {
    expect(filename).toBe("journal-des-ventes-2026.csv");
    expect(count).toBe(3);
    // A byte-order mark first, so Excel reads the accents.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(rows[0]).toBe("Date;Numéro;Type;Client;SIREN client;N° TVA client;Base HT 20 %;TVA 20 %;Base HT 5,5 %;TVA 5,5 %;Total HT;Total TVA;Total TTC;Payé;Reste dû;Échéance;Statut;Pièce liée");
    expect(rows.slice(1, 4).map((r) => r.split(";").slice(0, 2).join(";"))).toEqual(["2026-03-10;FAC-2026-0001", "2026-04-01;FAC-2026-0002", "2026-04-15;AV-2026-0001"]);
  });

  it("writes exact amounts with a decimal comma, credit notes negative, the year's totals net of them", () => {
    // The client's name holds the separator: it is quoted.
    expect(rows[2]).toBe('2026-04-01;FAC-2026-0002;Facture;"Client; Essai";987654324;;1000,00;200,00;100,00;5,50;1100,00;205,50;1305,50;500,00;805,50;2026-05-01;Payée en partie;');
    expect(rows[3]).toBe('2026-04-15;AV-2026-0001;Avoir;"Client; Essai";987654324;;-500,00;-100,00;;;-500,00;-100,00;-600,00;;;;Émis;FAC-2026-0001');
    // 500 + 1000 − 500 at 20 %; 100 at 5,5 %.
    expect(rows[4]).toBe(";;Total;;;;1000,00;200,00;100,00;5,50;1100,00;205,50;1305,50;;;;;");
  });

  it("is a header alone for a year without sales", () => {
    const empty = salesJournal(docs, 2024);
    expect(empty.count).toBe(0);
    expect(empty.csv.slice(1).trimEnd().split("\r\n")).toHaveLength(1);
  });
});

/** French amounts use no-break spaces ("1 200,00 €"): compared here with plain ones. */
const plain = (s: string) => s.replace(/[^\S\n]/g, " ");

describe("the payment reminder", () => {
  const invoice = (over: Parameters<typeof doc>[3] = {}) => doc("invoice", "FAC-2026-0007", [line(100_000, 2000)], { issueDate: "2026-03-01", dueDate: "2026-03-31", ...over });

  it("is only for what is still owed", () => {
    expect(reminderOf(invoice({ payments: [{ id: "p", date: "2026-03-20", amountCents: 120_000, method: "transfer" }] }), "2026-04-10")).toBeNull();
    expect(reminderOf(invoice({ state: "cancelled" }), "2026-04-10")).toBeNull();
    expect(reminderOf(doc("credit", "AV-2026-0001", [line(1, 2000)]), "2026-04-10")).toBeNull();
    expect(reminderOf(doc("invoice", null, [line(1, 2000)]), "2026-04-10")).toBeNull();
  });

  it("is courteous before and just after the due date, with how to pay", () => {
    const r0 = reminderOf(invoice(), "2026-04-05")!;
    const r = { ...r0, body: plain(r0.body) };
    expect(r).toMatchObject({ level: 1, daysLate: 5, to: "dominique@client.test" });
    expect(r.subject).toBe("Rappel — facture n° FAC-2026-0007 échue le 31/03/2026");
    expect(r.body).toContain("Bonjour Dominique,");
    expect(r.body).toContain("- Reste dû : 1 200,00 €");
    expect(r.body).toContain("(dépassée de 5 jours)");
    expect(r.body).toContain("IBAN FR76 3000 6000 0112 3456 7890 189 — BIC BNPAFRPP");
    expect(r.body).not.toContain("pénalités");
    const early = reminderOf(invoice(), "2026-03-20")!;
    expect(early.subject).toBe("Rappel — facture n° FAC-2026-0007");
  });

  it("recalls the penalties past fifteen days, and the €40 fee only between businesses", () => {
    const partial = invoice({ payments: [{ id: "p", date: "2026-04-01", amountCents: 20_000, method: "transfer" }] });
    const r1 = reminderOf(partial, "2026-04-20")!;
    const r = { ...r1, body: plain(r1.body) };
    expect(r).toMatchObject({ level: 2, daysLate: 20 });
    expect(r.subject.startsWith("Relance")).toBe(true);
    // Factual: LifeOS does not know whether an earlier reminder was sent, so it never says so.
    expect(r.body).toContain("reste impayée alors que son échéance est dépassée :");
    expect(r.body).toContain("(dépassée de 20 jours)");
    expect(r.body).not.toMatch(/précédent|rappel/i);
    expect(r.body).toContain("- Déjà réglé : 200,00 €");
    expect(r.body).toContain("- Reste dû : 1 000,00 €");
    expect(r.body).toContain("pénalités de retard s'appliquent, au taux de trois fois le taux d'intérêt légal");
    expect(r.body).toContain("40 €");
    const p0 = reminderOf(invoice({ client: { ...company, kind: "person", contact: undefined } }), "2026-04-20")!;
    const person = { ...p0, body: plain(p0.body) };
    expect(person.body).not.toContain("40 €");
    expect(person.body.startsWith("Bonjour,")).toBe(true);
  });

  it("opens the owner's mailbox with the address readable and the text encoded", () => {
    const url = mailtoOf(reminderOf(invoice(), "2026-04-05")!);
    expect(url.startsWith("mailto:dominique@client.test?subject=Rappel%20%E2%80%94%20facture")).toBe(true);
    expect(url).toContain("&body=Bonjour%20Dominique%2C");
  });
});
