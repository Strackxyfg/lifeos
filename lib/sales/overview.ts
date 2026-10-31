import { wallTime } from "@/lib/reminders/zoned";
import { balanceOf } from "./compute";
import { statusOf, type Status } from "./legal";
import type { Client, DocKind, SalesDoc } from "./model";

/**
 * What the sales page and the agent say about the documents: one row per
 * document, and the few figures that matter — what is still owed, what is
 * late, what was invoiced this year, which quotes wait for an answer.
 * Computed from the documents themselves, never stored.
 */

export interface DocRow {
  id: string;
  kind: DocKind;
  number: string | null;
  status: Status;
  clientName: string | null;
  issueDate: string;
  dueDate: string | null;
  grossCents: number;
  balanceCents: number;
}

export interface SalesFigures {
  outstanding: { cents: number; count: number };
  overdue: { cents: number; count: number };
  /** Excluding VAT, the year's credit notes deducted. */
  invoicedYear: { year: number; netCents: number };
  quotesOpen: { cents: number; count: number };
}

export function rowsOf(docs: SalesDoc[], clients: Client[], today: string): DocRow[] {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  // Drafts first, then the newest: by date, then by the moment of issue (or of creation).
  const at = (d: SalesDoc) => d.issuedAt ?? d.createdAt;
  return [...docs]
    .sort((a, b) => Number(b.number === null) - Number(a.number === null) || b.content.issueDate.localeCompare(a.content.issueDate) || at(b).localeCompare(at(a)))
    .map((d) => {
      const status = statusOf(d, today);
      return {
        id: d.id,
        kind: d.kind,
        number: d.number,
        status,
        // An issued document names the client as it was; a draft, as it is.
        clientName: d.content.client?.name ?? (d.content.clientId ? names.get(d.content.clientId) ?? null : null),
        issueDate: d.content.issueDate,
        dueDate: d.content.dueDate ?? null,
        grossCents: d.totals.grossCents,
        balanceCents: d.kind === "invoice" && d.number !== null && status !== "cancelled" ? balanceOf(d.totals, d.payments) : 0,
      };
    });
}

export function figuresOf(rows: DocRow[], docs: SalesDoc[], today: string): SalesFigures {
  const year = Number(today.slice(0, 4));
  const owed = rows.filter((r) => r.kind === "invoice" && r.balanceCents > 0);
  const late = owed.filter((r) => r.status === "overdue");
  const open = rows.filter((r) => r.kind === "quote" && r.status === "sent");
  const inYear = docs.filter((d) => d.number !== null && d.content.issueDate.startsWith(`${year}-`));
  const netCents =
    inYear.filter((d) => d.kind === "invoice").reduce((s, d) => s + d.totals.netCents, 0) -
    inYear.filter((d) => d.kind === "credit").reduce((s, d) => s + d.totals.netCents, 0);
  const sum = (xs: DocRow[], f: (r: DocRow) => number) => xs.reduce((s, r) => s + f(r), 0);
  return {
    outstanding: { cents: sum(owed, (r) => r.balanceCents), count: owed.length },
    overdue: { cents: sum(late, (r) => r.balanceCents), count: late.length },
    invoicedYear: { year, netCents },
    quotesOpen: { cents: sum(open, (r) => r.grossCents), count: open.length },
  };
}

/** Today in France, where the documents are dated: the same day for the page and for the numbers. */
export function parisToday(now = new Date()): string {
  const w = wallTime(now, "Europe/Paris");
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}
