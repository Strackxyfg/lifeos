/**
 * The amounts of a quote, an invoice or a credit note — exact.
 *
 * Money is held in whole cents, quantities in thousandths, rates and
 * discounts in basis points (20 % = 2000). Every product is computed with
 * big integers and rounded once, half up, to the cent: no floating-point
 * error ever reaches a total. VAT is computed per rate on the sum of the
 * lines at that rate, as French practice has it, and the regime of VAT
 * exemption ("franchise en base", art. 293 B du CGI) charges none.
 */

export interface Line {
  id: string;
  description: string;
  /** Up to three decimals (1.5 hours). */
  quantity: number;
  unit: string;
  /** Excluding VAT, in cents. */
  unitPriceCents: number;
  /** 2000 = 20 %. */
  vatBp: number;
  /** 0 to 10000 (100 %). */
  discountBp: number;
}

export interface VatBand {
  vatBp: number;
  baseCents: number;
  vatCents: number;
}

export interface Totals {
  netCents: number;
  vatCents: number;
  grossCents: number;
  bands: VatBand[];
}

export interface Payment {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  amountCents: number;
  method: "transfer" | "card" | "cash" | "cheque" | "other";
  /** The income recorded in finance for it, when there is one. */
  transactionId?: string | null;
}

/** French VAT rates in force, for the picker; any rate from 0 to 100 % is accepted. */
export const FRENCH_VAT_BP = [2000, 1000, 550, 210, 0] as const;

/** n / d rounded half up, for non-negative n and positive d. */
function divRound(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

/** A quantity in thousandths, from what was typed. */
export const milli = (quantity: number) => BigInt(Math.round(quantity * 1000));

/** A line's amount excluding VAT, after its discount. */
export function lineNet(line: Pick<Line, "quantity" | "unitPriceCents" | "discountBp">): number {
  const q = milli(line.quantity);
  const price = BigInt(Math.round(line.unitPriceCents));
  const keep = BigInt(10_000 - Math.round(line.discountBp));
  if (q <= 0n || price <= 0n || keep <= 0n) return 0;
  return Number(divRound(q * price * keep, 1000n * 10_000n));
}

/** The totals of a document; VAT charged only outside the exemption regime. */
export function totalsOf(lines: Line[], regime: "franchise" | "normal"): Totals {
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const rate = regime === "franchise" ? 0 : Math.round(l.vatBp);
    byRate.set(rate, (byRate.get(rate) ?? 0) + lineNet(l));
  }
  const bands = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([vatBp, baseCents]) => ({ vatBp, baseCents, vatCents: Number(divRound(BigInt(baseCents) * BigInt(vatBp), 10_000n)) }));
  const netCents = bands.reduce((s, b) => s + b.baseCents, 0);
  const vatCents = bands.reduce((s, b) => s + b.vatCents, 0);
  return { netCents, vatCents, grossCents: netCents + vatCents, bands };
}

export const paidOf = (payments: Payment[]) => payments.reduce((s, p) => s + p.amountCents, 0);

/** What is still owed. Never negative: an overpayment shows as nothing due. */
export const balanceOf = (totals: Totals, payments: Payment[]) => Math.max(0, totals.grossCents - paidOf(payments));

/** "1 234,56 €" — French grouping and comma; another locale for English. */
export function formatCents(cents: number, locale: "fr" | "en" = "fr", currency = "EUR"): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency }).format(cents / 100);
}

/** "20 %", "5,5 %". */
export function formatRate(bp: number, locale: "fr" | "en" = "fr"): string {
  return `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 2 }).format(bp / 100)} %`;
}

/** Euros as typed ("1 234,5", "1234.50") → cents, or null. */
export function parseEuros(raw: string): number | null {
  const s = raw.replace(/\s| |€/g, "").replace(",", ".");
  if (!/^\d{1,10}(\.\d{0,2})?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  return Number(int) * 100 + Number((frac + "00").slice(0, 2));
}
