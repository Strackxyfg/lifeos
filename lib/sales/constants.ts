/**
 * The fixed lists of sales — kinds, natures, legal forms, payment methods.
 *
 * Apart from `model.ts` (which re-exports them) so that a page can show them
 * without bringing the validation library into the browser.
 */

export const DOC_KINDS = ["quote", "invoice", "credit"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const NATURES = ["services", "goods", "mixed"] as const;
export type Nature = (typeof NATURES)[number];

export const LEGAL_FORMS = ["EI", "EIRL", "Micro-entreprise", "EURL", "SARL", "SAS", "SASU", "SA", "SCI", "SNC", "Association", "Autre"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const PAYMENT_METHODS = ["transfer", "card", "cash", "cheque", "other"] as const;
