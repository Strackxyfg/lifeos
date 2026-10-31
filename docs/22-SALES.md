# Sales — quotes, invoices, credit notes

`/sales` turns LifeOS into invoicing software for a French business: a
client directory, a catalogue, quotes, invoices and credit notes numbered
without gaps, with the mentions the law asks for, printed on A4 or saved as
PDF. It is part of the **Solo** edition (feature `invoicing`).

> **Status.** Built and tested on the local store (unit, store and action
> tests; the whole flow driven in the browser in French and English, desktop
> and 375 px). Migration `017_sales.sql` has been reviewed but **not yet run
> on Postgres**: apply it on Supabase before opening sales to anyone there.
> LifeOS is **not** a *plateforme agréée* for electronic invoicing (see §6).
> This is the shape of a compliant document, not legal advice: an accountant
> has the last word on a given business.

---

## 1. What a person does

| Tab | What it holds |
|---|---|
| Documents | KPIs (still owed, overdue, invoiced this year excl. VAT net of credit notes, quotes awaiting an answer), every document with its status, filter by kind, search by number or client |
| Clients | company or individual, address, SIREN/SIRET, VAT number; archived, never deleted |
| Catalogue | name, unit, unit price excl. VAT, VAT rate — added to a document in one click |
| My business | legal name, form, capital, address, SIREN/SIRET, registry, VAT regime (*franchise en base* or VAT charged, optional VAT on debits), IBAN/BIC, payment terms, late-payment rate, quote validity, footer |

A **draft** is edited freely: client, dates, nature of the operations,
delivery address, lines (quantity to three decimals, unit price, VAT rate,
discount), a printed note. The sheet beside it is exactly what will be
printed; what still blocks issuing is listed as it is typed, with the same
rules the server applies (`checkBeforeIssue`).

**Issuing** gives the number, dates the document today (its due date or
validity keeps the same delay), and freezes it: the client and the business
are copied as they are that day. After that:

- a quote is answered (accepted / declined / back to awaiting) and turned
  into an invoice draft, which says "Établie d'après le devis n° …";
- an invoice receives payments (never more than what is owed) — each is also
  written to Finance as income, on the day received, and removed with it;
- an invoice is cancelled by a credit note: a draft for the whole amount,
  editable for a partial credit; once credit notes cover it, it is cancelled;
- any quote or invoice is duplicated into a new draft.

## 2. Code

| Where | What |
|---|---|
| `lib/sales/compute.ts` | money in cents, quantities in thousandths, rates in basis points; BigInt products rounded once, half up; VAT per rate on the sum of its lines |
| `lib/sales/identifiers.ts` | SIREN/SIRET (Luhn, La Poste exception), FR VAT key, EU VAT shapes, IBAN mod 97 |
| `lib/sales/model.ts` | types and zod schemas of everything a page sends |
| `lib/sales/legal.ts` | numbering `DEV/FAC/AV-YYYY-NNNN`, `statusOf`, `checkBeforeIssue`, the printed identity lines and legal mentions |
| `lib/sales/overview.ts` | rows and figures of the page and the agent; `parisToday()` |
| `lib/sales/store*.ts`, `file.ts` | one contract, two stores: Supabase (migration 017) or `sales.json` in the data folder |
| `app/actions/sales.ts` | every write: signed in, edition, migration, input checked |
| `lib/sales/agent.ts` | the agent's two tools |
| `components/sales/*`, `app/(app)/sales/*` | the pages; `DocSheet` is the printed document |

## 3. The rules, and who keeps them

| Rule | Kept by |
|---|---|
| A number only on issue, the next of its series (kind × year), never shared, never skipped | `lifeos_issue_sales_doc()` under a row lock (Supabase); the global write queue (local) |
| An issued document's number, kind, content, totals and issue time never change; it is never deleted | the `lifeos_sales_docs_guard` trigger and the RLS policies (Supabase); the local store; the actions |
| A draft can be deleted: it has no number, so no gap | same |
| Erasing one's data removes the documents but keeps the counters: a series never starts over | `lifeos_sales_erase()`; the local store |
| Above 9 999 a number grows (`FAC-2026-10000`) rather than being truncated | the issue function (`lpad` would truncate) |
| Every action checks the session, the edition (`locked("invoicing")`) and the migration | `app/actions/sales.ts`, tested in `tests/editions.test.ts` |

The documents are printed in French whatever the interface language, as the
law requires for invoices issued in France.

## 4. Mentions printed

Issuer: legal name (and "Entrepreneur individuel (EI)" for a sole trader),
trade name, form and capital for a company, address, SIRET or SIREN,
registry, intra-EU VAT number when VAT is charged. Client: name, contact,
address, SIREN, VAT number. Then: nature of the operations; date or period of
the sale or service; delivery address if different; "TVA non applicable,
art. 293 B du CGI" or the option for VAT on debits; for an invoice, the due
date, no discount for early payment, the late-payment rate, the €40 recovery
fee between businesses (art. L441-10 and D441-5 of the Code de commerce), the
quote it comes from; for a credit note, the invoice it cancels; for a quote,
its validity and "bon pour accord"; the IBAN for a transfer.

Before issuing, a warning (not a block) is shown for a French company client
without SIREN — a required mention once electronic invoicing applies — and
for a company outside France without a VAT number.

## 5. The agent

| Tool | Capability | Tier | Does |
|---|---|---|---|
| `sales_overview` | `sales.read` | safe | the figures, every document with its status, clients and catalogue with ids |
| `sales_draft` | `sales.draft` | low | a draft quote or invoice from client and catalogue ids and typed lines; every amount checked, nothing guessed |
| — | `sales.issue` | **forbidden** | issuing stays the owner's act, on the page |

Both tools are offered in the app only (`APP_ONLY` in `mcp-tools.ts`): they
read and write through the owner's signed-in session, which an outside MCP
client does not have. Verified live: asked to prepare an invoice for a client
"from my catalogue", the agent read the overview, then drafted it with the
right client and catalogue ids.

## 6. What LifeOS is not

**Electronic invoicing.** Receiving electronic invoices is mandatory for every
business since 1 September 2026; issuing them through a *plateforme agréée*
becomes mandatory for small and micro businesses on 1 September 2027. LifeOS
prepares compliant invoices and keeps the numbering; it is not an approved
platform and does not transmit invoices to the tax administration. The
invoice page says so.

**Accounting.** Payments reach Finance as income; there is no ledger, no FEC
export, no VAT return.

**Keeping.** Invoices must be kept ten years (art. L123-22 of the Code de
commerce). They are in every export (`workspace.json`: business, clients,
catalogue, documents exactly as issued); the "delete my data" text asks to
export first.

## 7. Before opening it

1. Apply `supabase/migrations/017_sales.sql` (idempotent) and run the flow
   once on the real project: business → client → quote → issue → invoice →
   payment → credit note.
2. Have an accountant read one printed invoice of each kind for the business
   forms you sell to.
