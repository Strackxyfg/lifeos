import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { totalsOf } from "@/lib/sales/compute";
import type { DocContent } from "@/lib/sales/model";

/**
 * The local sales store keeps the invoicing rules: numbers given only on
 * issue, continuous per series and year even when issues race, issued
 * documents frozen and kept, the numbering surviving an erasure.
 */

vi.setConfig({ testTimeout: 30_000 });

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lifeos-sales-"));
  process.env.LIFEOS_DATA_DIR = dir;
});
afterAll(() => {
  delete process.env.LIFEOS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const content = (over: Partial<DocContent> = {}): DocContent => ({
  clientId: null,
  issueDate: "2026-10-30",
  nature: "services",
  lines: [{ id: "l1", description: "Conseil", quantity: 1, unit: "jour", unitPriceCents: 50_000, vatBp: 2000, discountBp: 0 }],
  ...over,
});
const totals = totalsOf(content().lines, "normal");
const store = async () => (await import("@/lib/sales/store-local")).localSalesStore;

describe("local sales store", () => {
  it("numbers only on issue, one continuous series per kind and year", async () => {
    const s = await store();
    const a = await s.createDraft("u1", "invoice", content(), totals);
    const b = await s.createDraft("u1", "invoice", content(), totals);
    const q = await s.createDraft("u1", "quote", content(), totals);
    expect(a.number).toBeNull();
    expect(await s.issue("u1", a.id, content(), totals, 2026)).toMatchObject({ number: "FAC-2026-0001" });
    expect(await s.issue("u1", q.id, content(), totals, 2026)).toMatchObject({ number: "DEV-2026-0001" });
    expect(await s.issue("u1", b.id, content(), totals, 2026)).toMatchObject({ number: "FAC-2026-0002" });
    // Another person has their own series.
    const other = await s.createDraft("u2", "invoice", content(), totals);
    expect(await s.issue("u2", other.id, content(), totals, 2026)).toMatchObject({ number: "FAC-2026-0001" });
  });

  it("never shares nor skips a number when issues race", async () => {
    const s = await store();
    const drafts = await Promise.all(Array.from({ length: 12 }, () => s.createDraft("race", "invoice", content(), totals)));
    const issued = await Promise.all(drafts.map((d) => s.issue("race", d.id, content(), totals, 2027)));
    const numbers = issued.map((d) => (typeof d === "string" ? d : d.number)).sort();
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => `FAC-2027-${String(i + 1).padStart(4, "0")}`));
  });

  it("freezes an issued document: no edit, no delete, no second number", async () => {
    const s = await store();
    const d = await s.createDraft("u3", "invoice", content(), totals);
    await s.issue("u3", d.id, content(), totals, 2026);
    expect(await s.saveDraft("u3", d.id, content({ notes: "changed" }), totals)).toBe("not_draft");
    expect(await s.deleteDraft("u3", d.id)).toBe("not_draft");
    expect(await s.issue("u3", d.id, content(), totals, 2026)).toBe("not_draft");
    // What may move: its state and its payments.
    expect(await s.setState("u3", d.id, "cancelled")).toMatchObject({ state: "cancelled", number: "FAC-2026-0001" });
    expect(await s.setPayments("u3", d.id, [{ id: "p", date: "2026-11-02", amountCents: 1_000, method: "transfer" }])).toMatchObject({ payments: [{ amountCents: 1_000 }] });
    // A draft can be edited and deleted.
    const draft = await s.createDraft("u3", "quote", content(), totals);
    expect(await s.saveDraft("u3", draft.id, content({ notes: "ok" }), totals)).toMatchObject({ content: { notes: "ok" } });
    expect(await s.deleteDraft("u3", draft.id)).toBe(true);
    expect(await s.getDoc("u3", draft.id)).toBeNull();
    expect(await s.saveDraft("u3", "nope", content(), totals)).toBe("missing");
  });

  it("keeps each person to their own rows", async () => {
    const s = await store();
    const d = await s.createDraft("u4", "invoice", content(), totals);
    expect(await s.getDoc("someone-else", d.id)).toBeNull();
    expect(await s.issue("someone-else", d.id, content(), totals, 2026)).toBe("missing");
    expect(await s.deleteDraft("someone-else", d.id)).toBe("missing");
  });

  it("erases the person's sales, but the numbering continues", async () => {
    const s = await store();
    const c = await s.saveClient("u5", null, { kind: "company", name: "Acme", address: { line1: "1 rue", postalCode: "75001", city: "Paris", country: "France" } });
    expect(c?.name).toBe("Acme");
    const d = await s.createDraft("u5", "invoice", content(), totals);
    await s.issue("u5", d.id, content(), totals, 2026);
    await s.erase("u5");
    expect(await s.listDocs("u5")).toEqual([]);
    expect(await s.listClients("u5")).toEqual([]);
    const again = await s.createDraft("u5", "invoice", content(), totals);
    expect(await s.issue("u5", again.id, content(), totals, 2026)).toMatchObject({ number: "FAC-2026-0002" });
  });

  it("keeps clients and catalogue items, archived rather than deleted", async () => {
    const s = await store();
    const c = await s.saveClient("u6", null, { kind: "person", name: "Zoé", address: { line1: "2 rue", postalCode: "69001", city: "Lyon", country: "France" } });
    await s.saveClient("u6", null, { kind: "company", name: "Alpha", address: { line1: "3 rue", postalCode: "33000", city: "Bordeaux", country: "France" } });
    expect((await s.listClients("u6")).map((x) => x.name)).toEqual(["Alpha", "Zoé"]);
    expect(await s.setClientArchived("u6", c!.id, true)).toBe(true);
    expect((await s.getClient("u6", c!.id))?.archived).toBe(true);
    const item = await s.saveCatalogItem("u6", null, { name: "Journée de conseil", unit: "jour", unitPriceCents: 60_000, vatBp: 2000 });
    expect(await s.saveCatalogItem("u6", item!.id, { name: "Journée de conseil", unit: "jour", unitPriceCents: 65_000, vatBp: 2000 })).toMatchObject({ unitPriceCents: 65_000 });
    expect(await s.setCatalogArchived("u6", item!.id, true)).toBe(true);
  });
});
