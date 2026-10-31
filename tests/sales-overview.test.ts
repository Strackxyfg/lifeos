import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { totalsOf, type Payment } from "@/lib/sales/compute";
import type { Client, DocKind, DocState, SalesDoc } from "@/lib/sales/model";
import { figuresOf, parisToday, rowsOf } from "@/lib/sales/overview";

/**
 * The figures of the sales page and of the agent: computed from the
 * documents themselves — what is owed, what is late, what was invoiced in the
 * year net of credit notes, which quotes wait — and the agent's two tools,
 * which read and prepare drafts but never issue.
 */

vi.setConfig({ testTimeout: 30_000 });

const lines = (cents: number) => [{ id: "l", description: "x", quantity: 1, unit: "u", unitPriceCents: cents, vatBp: 2000, discountBp: 0 }];
let n = 0;
function doc(kind: DocKind, number: string | null, cents: number, over: { state?: DocState; issueDate?: string; dueDate?: string; validUntil?: string; payments?: Payment[]; clientId?: string } = {}): SalesDoc {
  n += 1;
  const issueDate = over.issueDate ?? "2026-10-01";
  return {
    id: `d${n}`,
    kind,
    number,
    state: over.state ?? "open",
    content: { clientId: over.clientId ?? null, issueDate, dueDate: over.dueDate, validUntil: over.validUntil, nature: "services", lines: lines(cents), client: number ? { kind: "company", name: "Frozen Co", address: { line1: "a", postalCode: "1", city: "c", country: "France" } } : undefined },
    totals: totalsOf(lines(cents), "normal"),
    payments: over.payments ?? [],
    issuedAt: number ? `${issueDate}T10:00:0${n % 10}Z` : null,
    createdAt: `${issueDate}T09:00:0${n % 10}Z`,
    updatedAt: `${issueDate}T09:00:00Z`,
  };
}
const client: Client = { id: "c1", kind: "company", name: "Live Co", address: { line1: "a", postalCode: "1", city: "c", country: "France" }, archived: false, createdAt: "", updatedAt: "" };

describe("the sales figures", () => {
  const today = "2026-10-31";
  const docs = [
    doc("invoice", "FAC-2026-0001", 100_000, { dueDate: "2026-10-15" }), // overdue: 1 200 €
    doc("invoice", "FAC-2026-0002", 50_000, { dueDate: "2026-11-30", payments: [{ id: "p", date: "2026-10-20", amountCents: 10_000, method: "transfer" }] }), // partial: 500 € owed
    doc("invoice", "FAC-2026-0003", 20_000, { dueDate: "2026-11-30", state: "cancelled" }),
    doc("credit", "AV-2026-0001", 20_000),
    doc("invoice", "FAC-2025-0009", 99_000, { issueDate: "2025-12-20", dueDate: "2026-01-19", payments: [{ id: "q", date: "2026-01-02", amountCents: 118_800, method: "transfer" }] }),
    doc("quote", "DEV-2026-0001", 30_000, { validUntil: "2026-11-30" }),
    doc("quote", "DEV-2026-0002", 30_000, { validUntil: "2026-10-01" }),
    doc("quote", null, 5_000, { clientId: "c1", issueDate: "2026-09-01" }),
  ];
  const rows = rowsOf(docs, [client], today);
  const f = figuresOf(rows, docs, today);

  it("says where each document stands, drafts first, then the newest", () => {
    expect(rows[0]).toMatchObject({ number: null, status: "draft", clientName: "Live Co" });
    expect(rows.find((r) => r.number === "FAC-2026-0001")).toMatchObject({ status: "overdue", balanceCents: 120_000 });
    expect(rows.find((r) => r.number === "FAC-2026-0002")).toMatchObject({ status: "partial", balanceCents: 50_000 });
    expect(rows.find((r) => r.number === "FAC-2026-0003")).toMatchObject({ status: "cancelled", balanceCents: 0 });
    expect(rows.find((r) => r.number === "FAC-2025-0009")).toMatchObject({ status: "paid", balanceCents: 0 });
    expect(rows.find((r) => r.number === "DEV-2026-0002")?.status).toBe("expired");
    expect(rows.at(-1)?.number).toBe("FAC-2025-0009");
    // An issued document names its client as it was on the day.
    expect(rows.find((r) => r.number === "FAC-2026-0001")?.clientName).toBe("Frozen Co");
  });

  it("adds up what is owed, what is late, the year net of credit notes, the quotes awaiting", () => {
    expect(f.outstanding).toEqual({ cents: 170_000, count: 2 });
    expect(f.overdue).toEqual({ cents: 120_000, count: 1 });
    // 1 000 + 500 + 200 invoiced in 2026, minus the 200 credited; 2025 left out.
    expect(f.invoicedYear).toEqual({ year: 2026, netCents: 150_000 });
    expect(f.quotesOpen).toEqual({ cents: 36_000, count: 1 });
  });

  it("dates by the French calendar, whatever the server's", () => {
    expect(parisToday(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(parisToday(new Date("2026-07-14T21:59:00Z"))).toBe("2026-07-14");
  });
});

const h = vi.hoisted(() => ({ locked: { current: null as string | null } }));
vi.mock("@/lib/plans/server", () => ({ locked: async () => h.locked.current }));

describe("the agent's sales tools", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "lifeos-sales-agent-"));
    process.env.LIFEOS_DATA_DIR = dir;
  });
  afterAll(() => {
    delete process.env.LIFEOS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("prepares a draft from the catalogue and typed lines — never issued — and refuses what it cannot check", async () => {
    const { createSalesDraft } = await import("@/lib/sales/agent");
    const { getSalesStore } = await import("@/lib/sales/store");
    const store = getSalesStore();
    const item = await store.saveCatalogItem("ada@x.test", null, { name: "Journée de conseil", unit: "jour", unitPriceCents: 65_000, vatBp: 2000 });
    const c = await store.saveClient("ada@x.test", null, { kind: "company", name: "Client Essai", address: { line1: "a", postalCode: "1", city: "c", country: "France" } });

    expect(await createSalesDraft("ada@x.test", { document: "receipt", lines: [{ description: "x" }] })).toMatchObject({ ok: false });
    expect(await createSalesDraft("ada@x.test", { document: "invoice", lines: [] })).toMatchObject({ ok: false });
    expect(await createSalesDraft("ada@x.test", { document: "invoice", clientId: "nobody", lines: [{ description: "x", unitPriceEuros: 1 }] })).toMatchObject({ ok: false });
    expect(await createSalesDraft("ada@x.test", { document: "invoice", lines: [{ description: "x" }] })).toMatchObject({ ok: false }); // no price
    expect(await createSalesDraft("ada@x.test", { document: "invoice", lines: [{ description: "x", unitPriceEuros: 10, vatRate: 120 }] })).toMatchObject({ ok: false });

    const r = await createSalesDraft("ada@x.test", {
      document: "invoice",
      clientId: c!.id,
      lines: [{ catalogId: item!.id, quantity: 2 }, { description: "Déplacement", unitPriceEuros: 80.5, vatRate: 20, discountPercent: 10 }],
    });
    expect(r).toMatchObject({ ok: true });
    const id = (r as { data: string }).data.match(/\[([^\]]+)\]/)![1];
    const draft = await store.getDoc("ada@x.test", id);
    expect(draft).toMatchObject({ kind: "invoice", number: null, content: { clientId: c!.id } });
    expect(draft!.content.lines.map((l) => [l.description, l.quantity, l.unitPriceCents, l.discountBp])).toEqual([
      ["Journée de conseil", 2, 65_000, 0],
      ["Déplacement", 1, 8_050, 1000],
    ]);
    // 1 300 + 72,45 = 1 372,45 excl. VAT.
    expect(draft!.totals.netCents).toBe(137_245);
  });

  it("reads the figures and the ids it needs; says no outside the edition", async () => {
    const { salesOverview } = await import("@/lib/sales/agent");
    const r = await salesOverview("ada@x.test");
    expect(r.ok).toBe(true);
    const text = (r as { data: string }).data;
    expect(text).toContain("The business is not filled in yet");
    expect(text).toMatch(/draft invoice \[[^\]]+\]/);
    expect(text).toMatch(/Client Essai \[[^\]]+\]/);
    expect(text).toMatch(/Journée de conseil \[[^\]]+\] · €650\.00 excl\. VAT per jour/);
    h.locked.current = "solo";
    expect(await salesOverview("ada@x.test")).toMatchObject({ ok: false });
    h.locked.current = null;
  });
});
