import { z } from "zod";
import { isEuVat, isFrenchVat, isIban, isSiren, isSiret } from "./identifiers";
import type { Line, Payment, Totals } from "./compute";

/**
 * Sales: the business that sells (the issuer), its clients, its catalogue,
 * and its quotes, invoices and credit notes.
 *
 * A document is a draft until it is issued. Issuing gives it its number —
 * the next in its series, continuous, per year — and freezes it: the client
 * and the issuer as they were that day, the lines, the totals. An issued
 * invoice is never edited nor deleted; it is paid, or cancelled by a credit
 * note. That is the law for invoices, and it is enforced by the store (and
 * in Supabase, by the database itself), not only by the page.
 */

export const DOC_KINDS = ["quote", "invoice", "credit"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const NATURES = ["services", "goods", "mixed"] as const;
export type Nature = (typeof NATURES)[number];

export const LEGAL_FORMS = ["EI", "EIRL", "Micro-entreprise", "EURL", "SARL", "SAS", "SASU", "SA", "SCI", "SNC", "Association", "Autre"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const PAYMENT_METHODS = ["transfer", "card", "cash", "cheque", "other"] as const;

export interface Address {
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  country: string;
}

/** The business that issues the documents — as it is now; each issued document keeps a copy as it was. */
export interface Issuer {
  legalName: string;
  /** The name it trades under, if different. */
  tradeName?: string;
  form?: LegalForm;
  /** Share capital in cents, for companies. */
  capitalCents?: number;
  address: Address;
  siren: string;
  siret?: string;
  /** "RCS Paris", "RM 75" … */
  registry?: string;
  /** "franchise": no VAT charged (art. 293 B du CGI). */
  vatRegime: "franchise" | "normal";
  vatNumber?: string;
  /** VAT paid on debits rather than receipts (a mention when chosen). */
  vatOnDebits?: boolean;
  email?: string;
  phone?: string;
  iban?: string;
  bic?: string;
  /** Days between issue and due date, by default. */
  paymentDays: number;
  /** What late payment costs, as written on invoices. */
  latePenalty: string;
  quoteValidityDays: number;
  /** Shown at the bottom of every document. */
  footer?: string;
}

export interface Client {
  id: string;
  kind: "company" | "person";
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  address: Address;
  siren?: string;
  vatNumber?: string;
  notes?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  description?: string;
  unit: string;
  unitPriceCents: number;
  vatBp: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ClientSnapshot = Pick<Client, "kind" | "name" | "contact" | "email" | "address" | "siren" | "vatNumber">;

/** What a document says. Frozen once issued. */
export interface DocContent {
  clientId: string | null;
  /** YYYY-MM-DD: the planned date of a draft; the date of issue once issued. */
  issueDate: string;
  /** Invoices: when payment is due. */
  dueDate?: string;
  /** Quotes: until when the offer holds. */
  validUntil?: string;
  /** The date of the sale or service, or the start of its period. */
  serviceDate?: string;
  serviceEnd?: string;
  nature: Nature;
  deliveryAddress?: string;
  lines: Line[];
  notes?: string;
  /** Credit notes: the invoice they cancel or reduce; invoices: the quote they come from. */
  relatedId?: string;
  relatedNumber?: string;
  /** Copies taken on issue. */
  client?: ClientSnapshot;
  issuer?: Issuer;
}

/** Decisions on a document beyond its payments: a quote accepted, declined or invoiced; an invoice cancelled. */
export type DocState = "open" | "accepted" | "declined" | "invoiced" | "cancelled";

export interface SalesDoc {
  id: string;
  kind: DocKind;
  number: string | null;
  state: DocState;
  content: DocContent;
  /** Computed while a draft; frozen on issue. */
  totals: Totals;
  payments: Payment[];
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const isDraft = (d: Pick<SalesDoc, "number">) => d.number === null;

/* ── Validation of what the page sends ────────────────────────────── */

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));

export const addressSchema = z.object({
  line1: text(200),
  line2: optText(200),
  postalCode: text(20),
  city: text(120),
  country: text(80).default("France"),
});

export const issuerSchema = z
  .object({
    legalName: text(200).min(1),
    tradeName: optText(200),
    form: z.enum(LEGAL_FORMS).optional(),
    capitalCents: z.number().int().min(0).max(1e13).optional(),
    address: addressSchema,
    siren: text(20).refine((v) => isSiren(v), "siren"),
    siret: optText(20).refine((v) => v === undefined || isSiret(v), "siret"),
    registry: optText(120),
    vatRegime: z.enum(["franchise", "normal"]),
    vatNumber: optText(20).refine((v) => v === undefined || isFrenchVat(v) || isEuVat(v), "vatNumber"),
    vatOnDebits: z.boolean().optional(),
    email: optText(200).refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "email"),
    phone: optText(40),
    iban: optText(40).refine((v) => v === undefined || isIban(v), "iban"),
    bic: optText(11).refine((v) => v === undefined || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(v), "bic"),
    paymentDays: z.number().int().min(0).max(60).default(30),
    latePenalty: text(300).default("Trois fois le taux d'intérêt légal"),
    quoteValidityDays: z.number().int().min(1).max(365).default(30),
    footer: optText(600),
  })
  .refine((v) => v.vatRegime === "franchise" || v.vatNumber !== undefined, { message: "vatNumber", path: ["vatNumber"] });

export const clientSchema = z.object({
  kind: z.enum(["company", "person"]),
  name: text(200).min(1),
  contact: optText(160),
  email: optText(200).refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "email"),
  phone: optText(40),
  address: addressSchema,
  siren: optText(20).refine((v) => v === undefined || isSiren(v) || isSiret(v), "siren"),
  vatNumber: optText(20).refine((v) => v === undefined || isEuVat(v), "vatNumber"),
  notes: optText(2000),
});

export const catalogSchema = z.object({
  name: text(200).min(1),
  description: optText(2000),
  unit: text(30).min(1),
  unitPriceCents: z.number().int().min(0).max(1e12),
  vatBp: z.number().int().min(0).max(10_000),
});

export const lineSchema = z.object({
  id: z.string().min(1).max(64),
  description: text(2000),
  quantity: z.number().min(0).max(1e6).refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, "quantity"),
  unit: text(30),
  unitPriceCents: z.number().int().min(0).max(1e12),
  vatBp: z.number().int().min(0).max(10_000),
  discountBp: z.number().int().min(0).max(10_000).default(0),
});

export const contentSchema = z.object({
  clientId: z.string().min(1).max(64).nullable(),
  issueDate: day,
  dueDate: day.optional(),
  validUntil: day.optional(),
  serviceDate: day.optional(),
  serviceEnd: day.optional(),
  nature: z.enum(NATURES),
  deliveryAddress: optText(400),
  lines: z.array(lineSchema).max(200),
  notes: optText(4000),
});

export const paymentSchema = z.object({
  date: day,
  amountCents: z.number().int().min(1).max(1e12),
  method: z.enum(PAYMENT_METHODS),
});

/** Days are compared as text: YYYY-MM-DD sorts like time. */
export function addDays(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
