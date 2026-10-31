import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Quotes, invoices and credit notes through the actions the pages call: who
 * may act, what must be filled before a number is given, the date of issue,
 * what an issued document refuses, payments reaching the finances, and an
 * invoice cancelled by its credit note.
 */

vi.setConfig({ testTimeout: 30_000 });

const h = vi.hoisted(() => ({ user: { current: "ada@x.test" as string | null }, locked: { current: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/plans/server", () => ({ locked: async () => h.locked.current }));
vi.mock("@/lib/db/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/store")>();
  return { ...real, getAuthenticatedUserKey: async () => h.user.current };
});

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lifeos-sales-actions-"));
  process.env.LIFEOS_DATA_DIR = dir;
});
afterAll(() => {
  delete process.env.LIFEOS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const actions = () => import("@/app/actions/sales");
const ZONE = "Europe/Paris";
const issuer = {
  legalName: "Atelier Ada",
  form: "SAS",
  capitalCents: 100_000,
  address: { line1: "1 rue de l'Essai", postalCode: "75001", city: "Paris", country: "France" },
  siren: "123456782",
  vatRegime: "normal",
  vatNumber: "FR11123456782",
  paymentDays: 30,
  latePenalty: "Trois fois le taux d'intérêt légal",
  quoteValidityDays: 30,
};
const client = { kind: "company", name: "Client Essai", address: { line1: "10 avenue de l'Exemple", postalCode: "69002", city: "Lyon", country: "France" }, siren: "987654324" };
const line = (over: Record<string, unknown> = {}) => ({ id: "l1", description: "Conseil", quantity: 2, unit: "jour", unitPriceCents: 50_000, vatBp: 2000, discountBp: 0, ...over });
/** The data of a result that must have succeeded, seen through the fields a test reads. */
const ok = <T,>(r: { ok: boolean }) => {
  expect(r).toMatchObject({ ok: true });
  return (r as unknown as { data: T }).data;
};

describe("sales actions", () => {
  it("refuses a signed-out person and an edition without invoicing", async () => {
    const a = await actions();
    h.user.current = null;
    expect(await a.saveIssuer(issuer)).toEqual({ ok: false, code: "unauthorized" });
    h.user.current = "ada@x.test";
    h.locked.current = "solo";
    expect(await a.createDocument("invoice", null, ZONE)).toEqual({ ok: false, code: "edition" });
    h.locked.current = null;
  });

  it("checks the business: a SIREN with a wrong key, a VAT number when VAT is charged", async () => {
    const a = await actions();
    expect(await a.saveIssuer({ ...issuer, siren: "123456789" })).toMatchObject({ ok: false, code: "invalid", field: "siren" });
    expect(await a.saveIssuer({ ...issuer, vatNumber: undefined })).toMatchObject({ ok: false, code: "invalid", field: "vatNumber" });
    expect(await a.saveIssuer(issuer)).toEqual({ ok: true, data: null });
  });

  it("issues nothing that misses what the law asks, then numbers and freezes it on the day of issue", async () => {
    const a = await actions();
    const { id } = ok<{ id: string }>(await a.createDocument("quote", null, ZONE));
    const early = await a.issueDocument(id, ZONE);
    expect(early).toMatchObject({ ok: false, code: "check" });
    expect((early as { problems: string[] }).problems).toEqual(expect.arrayContaining(["client_missing", "no_lines"]));

    const c = ok<{ id: string }>(await a.saveClient(null, client));
    // Planned for an old date: issuing dates it today and keeps the 30 days of validity.
    ok(await a.saveDraftDocument(id, { clientId: c.id, issueDate: "2026-01-01", validUntil: "2026-01-31", nature: "services", lines: [line()] }));
    const quote = ok<{ number: string; content: { issueDate: string; validUntil: string; client: { name: string }; issuer: { legalName: string } } }>(await a.issueDocument(id, ZONE));
    const { parisToday } = await import("@/lib/sales/overview");
    const { addDays } = await import("@/lib/sales/model");
    const today = parisToday();
    expect(quote.number).toBe(`DEV-${today.slice(0, 4)}-0001`);
    expect(quote.content.issueDate).toBe(today);
    expect(quote.content.validUntil).toBe(addDays(today, 30));
    expect(quote.content.client.name).toBe("Client Essai");
    expect(quote.content.issuer.legalName).toBe("Atelier Ada");

    // Issued: neither changed nor deleted, and the client's later changes do not reach it.
    expect(await a.saveDraftDocument(id, { clientId: c.id, issueDate: today, nature: "services", lines: [] })).toMatchObject({ ok: false, code: "not_draft" });
    expect(await a.deleteDraftDocument(id)).toMatchObject({ ok: false, code: "not_draft" });
    ok(await a.saveClient(c.id, { ...client, name: "Client Renamed" }));
    const { getSalesStore } = await import("@/lib/sales/store");
    expect((await getSalesStore().getDoc("ada@x.test", id))?.content.client?.name).toBe("Client Essai");
  });

  it("turns an accepted quote into an invoice, takes payments into the finances, cancels it by a credit note", async () => {
    const a = await actions();
    const { getSalesStore } = await import("@/lib/sales/store");
    const { getStore } = await import("@/lib/db/store");
    const store = getSalesStore();
    const quote = (await store.listDocs("ada@x.test")).find((d) => d.kind === "quote")!;
    ok(await a.markQuote(quote.id, "accepted"));
    const { id: invoiceId } = ok<{ id: string }>(await a.convertQuote(quote.id, ZONE));
    expect((await store.getDoc("ada@x.test", quote.id))?.state).toBe("invoiced");
    expect(await a.convertQuote(quote.id, ZONE)).toMatchObject({ ok: false, code: "not_issued" });

    const invoice = ok<{ number: string; totals: { grossCents: number }; content: { relatedNumber: string } }>(await a.issueDocument(invoiceId, ZONE));
    expect(invoice.number).toMatch(/^FAC-\d{4}-0001$/);
    expect(invoice.content.relatedNumber).toBe(quote.number);
    expect(invoice.totals.grossCents).toBe(120_000);

    const day = invoice.number.slice(4, 8) + "-01-15";
    expect(await a.recordPayment(invoiceId, { date: day, amountCents: 120_001, method: "transfer" })).toMatchObject({ ok: false, code: "too_much" });
    const paid = ok<{ payments: { id: string; transactionId: string }[] }>(await a.recordPayment(invoiceId, { date: day, amountCents: 50_000, method: "transfer" }));
    const income = (await getStore().list("ada@x.test", "transactions")).find((t) => t.id === paid.payments[0].transactionId);
    expect(income).toMatchObject({ type: "Income", amount: 500, category: "Ventes" });
    ok(await a.removePayment(invoiceId, paid.payments[0].id));
    expect((await getStore().list("ada@x.test", "transactions")).some((t) => t.id === paid.payments[0].transactionId)).toBe(false);

    const { id: creditId } = ok<{ id: string }>(await a.creditInvoice(invoiceId, ZONE));
    const credit = ok<{ number: string; content: { relatedNumber: string } }>(await a.issueDocument(creditId, ZONE));
    expect(credit.number).toMatch(/^AV-\d{4}-0001$/);
    expect(credit.content.relatedNumber).toBe(invoice.number);
    expect((await store.getDoc("ada@x.test", invoiceId))?.state).toBe("cancelled");
    expect(await a.recordPayment(invoiceId, { date: day, amountCents: 100, method: "cash" })).toMatchObject({ ok: false, code: "not_issued" });
  });

  it("keeps each person's documents to themselves", async () => {
    const a = await actions();
    const { getSalesStore } = await import("@/lib/sales/store");
    const ada = await getSalesStore().listDocs("ada@x.test");
    h.user.current = "eve@x.test";
    expect(await a.markQuote(ada[0].id, "declined")).toMatchObject({ ok: false, code: "not_found" });
    expect(await getSalesStore().listDocs("eve@x.test")).toEqual([]);
    h.user.current = "ada@x.test";
  });
});
