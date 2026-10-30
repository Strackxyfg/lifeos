import { describe, it, expect } from "vitest";
import { formatIban, formatSiren, frenchVatOf, isEuVat, isFrenchVat, isIban, isSiren, isSiret, sirenOf } from "@/lib/sales/identifiers";
import { balanceOf, formatCents, formatRate, lineNet, parseEuros, totalsOf, type Line } from "@/lib/sales/compute";
import { checkBeforeIssue, clientLines, formatNumber, issuerLines, mentionsOf, parseNumber, statusOf } from "@/lib/sales/legal";
import { addDays, clientSchema, contentSchema, issuerSchema, type Client, type DocContent, type Issuer, type SalesDoc } from "@/lib/sales/model";

/**
 * Sales, the arithmetic and the law: identifiers checked like the
 * administration checks them, amounts exact to the cent, numbers continuous,
 * and what a document must say before it can be issued.
 */

describe("identifiers", () => {
  it("checks SIREN and SIRET with their key", () => {
    expect(isSiren("732 829 320")).toBe(true);
    expect(isSiren("732829321")).toBe(false);
    expect(isSiren("12345678")).toBe(false);
    expect(isSiret("552 032 534 00646")).toBe(true);
    expect(isSiret("55203253400647")).toBe(false);
    // La Poste's establishments: the sum of the digits is a multiple of 5.
    expect(isSiret("35600000000001")).toBe(true);
    expect(isSiret("35600000000002")).toBe(false);
  });

  it("checks French VAT numbers, and derives one from a SIREN", () => {
    expect(frenchVatOf("732829320")).toBe("FR44732829320");
    expect(isFrenchVat("FR 44 732 829 320")).toBe(true);
    expect(isFrenchVat("FR45732829320")).toBe(false);
    expect(isFrenchVat("FR44732829321")).toBe(false);
    expect(isFrenchVat("FRAB732829320")).toBe(true); // alphanumeric keys cannot be checked offline
    expect(isEuVat("DE123456789")).toBe(true);
    expect(isEuVat("US123456789")).toBe(false);
    expect(sirenOf("FR44732829320")).toBe("732829320");
    expect(sirenOf("55203253400646")).toBe("552032534");
  });

  it("checks IBANs with their check digits and length", () => {
    expect(isIban("FR14 2004 1010 0505 0001 3M02 606")).toBe(true);
    expect(isIban("FR14 2004 1010 0505 0001 3M02 607")).toBe(false);
    expect(isIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isIban("FR14 2004 1010 0505 0001 3M02 60")).toBe(false);
    expect(formatIban("fr1420041010050500013m02606")).toBe("FR14 2004 1010 0505 0001 3M02 606");
    expect(formatSiren("73282932000074")).toBe("732 829 320 00074");
  });
});

const line = (over: Partial<Line> = {}): Line => ({ id: "l", description: "Conseil", quantity: 1, unit: "jour", unitPriceCents: 50_000, vatBp: 2000, discountBp: 0, ...over });

describe("amounts", () => {
  it("is exact where floating point is not", () => {
    // 0.1 × 3 is not 0.3 in floating point; in cents it is.
    expect(lineNet(line({ quantity: 3, unitPriceCents: 10 }))).toBe(30);
    expect(lineNet(line({ quantity: 1.333, unitPriceCents: 9_999 }))).toBe(13_329); // 13 328.667 → 13 329
    expect(lineNet(line({ quantity: 2, unitPriceCents: 12_345, discountBp: 1_000 }))).toBe(22_221); // 24 690 × 0.9 = 22 221
    expect(lineNet(line({ quantity: 0.5, unitPriceCents: 1 }))).toBe(1); // half a cent rounds up
    expect(lineNet(line({ quantity: 1e6, unitPriceCents: 1e12 }))).toBe(1e18); // no overflow before rounding
  });

  it("computes VAT per rate on the sum of the lines, rounded once", () => {
    const t = totalsOf(
      [line({ unitPriceCents: 333, quantity: 3 }), line({ unitPriceCents: 1_000, vatBp: 550 }), line({ unitPriceCents: 1_001, vatBp: 2000 })],
      "normal"
    );
    expect(t.bands).toEqual([
      { vatBp: 2000, baseCents: 2_000, vatCents: 400 },
      { vatBp: 550, baseCents: 1_000, vatCents: 55 },
    ]);
    expect(t).toMatchObject({ netCents: 3_000, vatCents: 455, grossCents: 3_455 });
  });

  it("charges no VAT under the exemption regime", () => {
    expect(totalsOf([line()], "franchise")).toMatchObject({ netCents: 50_000, vatCents: 0, grossCents: 50_000, bands: [{ vatBp: 0 }] });
  });

  it("tracks what is still owed, never below zero", () => {
    const t = totalsOf([line()], "normal");
    expect(balanceOf(t, [{ id: "p", date: "2026-10-01", amountCents: 20_000, method: "transfer" }])).toBe(40_000);
    expect(balanceOf(t, [{ id: "p", date: "2026-10-01", amountCents: 70_000, method: "transfer" }])).toBe(0);
  });

  it("reads and writes euros the French way", () => {
    expect(parseEuros("1 234,5")).toBe(123_450);
    expect(parseEuros("1234.56 €")).toBe(123_456);
    expect(parseEuros("12,345")).toBeNull();
    expect(parseEuros("-3")).toBeNull();
    expect(formatCents(123_456)).toMatch(/^1\s234,56\s€$/);
    expect(formatRate(550)).toBe("5,5 %");
  });
});

describe("numbers", () => {
  it("formats one continuous series per kind and year", () => {
    expect(formatNumber("invoice", 2026, 1)).toBe("FAC-2026-0001");
    expect(formatNumber("quote", 2026, 42)).toBe("DEV-2026-0042");
    expect(formatNumber("credit", 2027, 12_345)).toBe("AV-2027-12345");
    expect(parseNumber("FAC-2026-0007")).toEqual({ kind: "invoice", year: 2026, seq: 7 });
    expect(parseNumber("INV-1")).toBeNull();
  });
});

const issuer: Issuer = {
  legalName: "Camille Martin",
  form: "EI",
  address: { line1: "12 rue de la Paix", postalCode: "75002", city: "Paris", country: "France" },
  siren: "732829320",
  vatRegime: "franchise",
  paymentDays: 30,
  latePenalty: "Trois fois le taux d'intérêt légal",
  quoteValidityDays: 30,
  iban: "FR14 2004 1010 0505 0001 3M02 606",
};
const company: Client = {
  id: "c1",
  kind: "company",
  name: "Acme SAS",
  address: { line1: "1 avenue des Champs", postalCode: "75008", city: "Paris", country: "France" },
  siren: "552032534",
  archived: false,
  createdAt: "",
  updatedAt: "",
};
const content = (over: Partial<DocContent> = {}): DocContent => ({
  clientId: "c1",
  issueDate: "2026-10-30",
  dueDate: "2026-11-29",
  serviceDate: "2026-10-28",
  nature: "services",
  lines: [line()],
  ...over,
});

describe("before issuing", () => {
  it("passes a complete invoice", () => {
    expect(checkBeforeIssue("invoice", content(), issuer, company)).toEqual({ problems: [], warnings: [] });
  });

  it("says what is missing, precisely", () => {
    const r = checkBeforeIssue(
      "invoice",
      content({ serviceDate: undefined, dueDate: "2026-10-01", lines: [line({ description: " ", quantity: 0 })] }),
      { ...issuer, siren: "123456789", vatRegime: "normal", vatNumber: undefined, address: { ...issuer.address, city: "" } },
      { ...company, address: { ...company.address, line1: "" }, siren: undefined }
    );
    expect(r.problems.sort()).toEqual(["client_address", "due_before_issue", "issuer_address", "issuer_siren", "issuer_vat", "line_description", "line_quantity", "service_date"].sort());
    expect(r.warnings).toEqual(["client_siren"]);
    expect(checkBeforeIssue("quote", content({ validUntil: undefined }), issuer, company).problems).toEqual(["valid_until"]);
    expect(checkBeforeIssue("credit", content(), issuer, company).problems).toEqual(["related_missing"]);
    expect(checkBeforeIssue("invoice", content(), null, null).problems).toEqual(["issuer_missing", "client_missing"]);
  });
});

describe("mentions", () => {
  it("prints what a French invoice must say", () => {
    const m = mentionsOf({ kind: "invoice", number: "FAC-2026-0001", content: content({ relatedNumber: "DEV-2026-0003" }) }, issuer, company);
    expect(m).toContain("Nature des opérations : Prestations de services.");
    expect(m).toContain("Date de réalisation : 28/10/2026.");
    expect(m).toContain("TVA non applicable, art. 293 B du CGI.");
    expect(m).toContain("Date d'échéance : 29/11/2026.");
    expect(m).toContain("Pas d'escompte pour paiement anticipé.");
    expect(m.some((x) => x.startsWith("En cas de retard de paiement : pénalités au taux de trois fois le taux d'intérêt légal"))).toBe(true);
    expect(m.some((x) => x.includes("40 €"))).toBe(true);
    expect(m).toContain("Établie d'après le devis n° DEV-2026-0003.");
    expect(m.some((x) => x.includes("IBAN FR14"))).toBe(true);
  });

  it("leaves the €40 indemnity to business clients, and says VAT on debits when chosen", () => {
    const person = { ...company, kind: "person" as const, siren: undefined };
    expect(mentionsOf({ kind: "invoice", number: "x", content: content() }, issuer, person).some((x) => x.includes("40 €"))).toBe(false);
    const vat = { ...issuer, vatRegime: "normal" as const, vatNumber: "FR44732829320", vatOnDebits: true };
    expect(mentionsOf({ kind: "invoice", number: "x", content: content() }, vat, company)).toContain("Option pour le paiement de la taxe d'après les débits.");
  });

  it("names an individual entrepreneur as one, and a company with its capital", () => {
    expect(issuerLines(issuer)[0]).toBe("Camille Martin — Entrepreneur individuel (EI)");
    const sas = { ...issuer, legalName: "Lumen", form: "SAS" as const, capitalCents: 100_000, vatRegime: "normal" as const, vatNumber: "FR44732829320", registry: "RCS Paris" };
    const lines = issuerLines(sas);
    expect(lines[0]).toBe("Lumen — SAS");
    expect(lines.some((l) => /^SAS au capital de 1\s000,00\s€$/.test(l))).toBe(true);
    expect(lines).toContain("RCS Paris");
    expect(lines).toContain("N° TVA intracommunautaire FR44732829320");
    expect(clientLines(company)).toContain("SIREN 552032534");
  });

  it("prints a quote's validity and the place to accept it, a credit note's invoice", () => {
    expect(mentionsOf({ kind: "quote", number: "x", content: content({ validUntil: "2026-11-29" }) }, issuer, company)).toEqual(
      expect.arrayContaining(["Devis valable jusqu'au 29/11/2026.", "Bon pour accord : date, signature et mention « bon pour accord »."])
    );
    expect(mentionsOf({ kind: "credit", number: "x", content: content({ relatedNumber: "FAC-2026-0001" }) }, issuer, company)).toContain("Avoir sur la facture n° FAC-2026-0001.");
  });
});

describe("status", () => {
  const doc = (over: Partial<SalesDoc>): SalesDoc => ({
    id: "d",
    kind: "invoice",
    number: "FAC-2026-0001",
    state: "open",
    content: content(),
    totals: totalsOf([line()], "normal"),
    payments: [],
    issuedAt: "2026-10-30T10:00:00Z",
    createdAt: "",
    updatedAt: "",
    ...over,
  });

  it("follows an invoice from issued to paid, overdue when late", () => {
    expect(statusOf(doc({ number: null }), "2026-10-30")).toBe("draft");
    expect(statusOf(doc({}), "2026-10-30")).toBe("issued");
    expect(statusOf(doc({ payments: [{ id: "p", date: "2026-11-01", amountCents: 1_000, method: "card" }] }), "2026-11-02")).toBe("partial");
    expect(statusOf(doc({}), "2026-11-30")).toBe("overdue");
    expect(statusOf(doc({ payments: [{ id: "p", date: "2026-11-01", amountCents: 60_000, method: "transfer" }] }), "2026-12-30")).toBe("paid");
    expect(statusOf(doc({ state: "cancelled" }), "2026-12-30")).toBe("cancelled");
  });

  it("follows a quote", () => {
    const q = (over: Partial<SalesDoc>) => doc({ kind: "quote", number: "DEV-2026-0001", content: content({ validUntil: "2026-11-29" }), ...over });
    expect(statusOf(q({}), "2026-11-01")).toBe("sent");
    expect(statusOf(q({}), "2026-12-01")).toBe("expired");
    expect(statusOf(q({ state: "accepted" }), "2026-12-01")).toBe("accepted");
    expect(statusOf(q({ state: "invoiced" }), "2026-12-01")).toBe("invoiced");
  });
});

describe("what the page sends", () => {
  it("validates an issuer: SIREN key, VAT number when VAT is charged, IBAN", () => {
    const ok = issuerSchema.safeParse({ ...issuer });
    expect(ok.success).toBe(true);
    expect(issuerSchema.safeParse({ ...issuer, siren: "732829321" }).success).toBe(false);
    expect(issuerSchema.safeParse({ ...issuer, vatRegime: "normal" }).success).toBe(false);
    expect(issuerSchema.safeParse({ ...issuer, vatRegime: "normal", vatNumber: "FR44732829320" }).success).toBe(true);
    expect(issuerSchema.safeParse({ ...issuer, iban: "FR14 2004 1010 0505 0001 3M02 607" }).success).toBe(false);
  });

  it("validates a client and a document", () => {
    expect(clientSchema.safeParse({ kind: "company", name: "Acme", address: company.address, siren: "552032534" }).success).toBe(true);
    expect(clientSchema.safeParse({ kind: "company", name: "Acme", address: company.address, siren: "552032535" }).success).toBe(false);
    expect(contentSchema.safeParse(content()).success).toBe(true);
    expect(contentSchema.safeParse(content({ issueDate: "2026-02-30" })).success).toBe(false);
    expect(contentSchema.safeParse(content({ lines: [line({ quantity: 1.0005 })] })).success).toBe(false);
  });

  it("adds days across months and leap years", () => {
    expect(addDays("2026-10-30", 30)).toBe("2026-11-29");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
