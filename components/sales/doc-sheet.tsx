import { balanceOf, formatCents, formatRate, lineNet, paidOf, type Payment, type Totals } from "@/lib/sales/compute";
import { clientLines, frDate, issuerLines, mentionsOf, TITLE } from "@/lib/sales/legal";
import type { ClientSnapshot, DocContent, DocKind, Issuer } from "@/lib/sales/model";
import { cn } from "@/lib/utils";

/**
 * A quote, an invoice or a credit note as it is printed: in French, on an
 * A4 sheet, with the mentions the law asks for. The same sheet is the
 * preview of a draft and the view of an issued document — what is seen is
 * what is printed.
 */
export function DocSheet({
  kind,
  number,
  content,
  totals,
  payments = [],
  cancelled = false,
  issuer,
  client,
  className,
}: {
  kind: DocKind;
  number: string | null;
  content: DocContent;
  totals: Totals;
  payments?: Payment[];
  /** Cancelled by a credit note: nothing is left to pay on it. */
  cancelled?: boolean;
  issuer: Issuer | null;
  client: ClientSnapshot | null;
  className?: string;
}) {
  const draft = number === null;
  const eur = (c: number) => formatCents(c, "fr");
  const franchise = issuer?.vatRegime === "franchise";
  const discounted = content.lines.some((l) => l.discountBp > 0);
  const paid = paidOf(payments);

  return (
    <article
      id="sales-doc"
      className={cn("relative mx-auto w-full max-w-[210mm] overflow-hidden rounded-xl border border-border bg-white p-6 text-[12px] leading-snug text-neutral-900 shadow-card sm:p-10", className)}
    >
      <header className="flex flex-col gap-6 sm:flex-row sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          {issuer ? (
            issuerLines(issuer).map((l, i) => (
              <p key={i} className={cn("break-words", i === 0 && "text-[14px] font-semibold")}>
                {l}
              </p>
            ))
          ) : (
            <p className="text-neutral-400">—</p>
          )}
        </div>
        <div className="shrink-0 sm:text-right">
          <h2 className="text-[22px] font-semibold tracking-tight">{TITLE[kind]}</h2>
          <p className="mt-0.5 font-mono text-[13px]">{draft ? "N° —" : `N° ${number}`}</p>
          {draft && <p className="mt-1 inline-block rounded border border-neutral-400 px-2 py-0.5 text-[10px] font-semibold tracking-[0.25em] text-neutral-500">BROUILLON</p>}
          <p className="mt-2">Date : {frDate(content.issueDate)}</p>
          {kind === "invoice" && content.dueDate && <p>Échéance : {frDate(content.dueDate)}</p>}
          {kind === "quote" && content.validUntil && <p>Valable jusqu&apos;au : {frDate(content.validUntil)}</p>}
          {content.relatedNumber && <p>{kind === "credit" ? "Facture" : "Devis"} : {content.relatedNumber}</p>}
        </div>
      </header>

      <section className="mt-8 flex sm:justify-end">
        <div className="w-full rounded-md border border-neutral-200 p-3 sm:w-[46%]">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Client</p>
          {client ? (
            clientLines(client).map((l, i) => (
              <p key={i} className={cn("break-words", i === 0 && "font-semibold")}>
                {l}
              </p>
            ))
          ) : (
            <p className="text-neutral-400">—</p>
          )}
        </div>
      </section>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-[10px] uppercase tracking-wider text-neutral-500">
              <th className="py-2 pr-2 font-medium">Désignation</th>
              <th className="py-2 pr-2 text-right font-medium">Qté</th>
              <th className="py-2 pr-2 font-medium">Unité</th>
              <th className="py-2 pr-2 text-right font-medium">PU HT</th>
              {discounted && <th className="py-2 pr-2 text-right font-medium">Remise</th>}
              {!franchise && <th className="py-2 pr-2 text-right font-medium">TVA</th>}
              <th className="py-2 text-right font-medium">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {content.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-neutral-400">—</td>
              </tr>
            ) : (
              content.lines.map((l) => (
                <tr key={l.id} className="border-b border-neutral-200 align-top">
                  <td className="whitespace-pre-line py-2 pr-2">{l.description}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{l.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}</td>
                  <td className="py-2 pr-2">{l.unit}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{eur(l.unitPriceCents)}</td>
                  {discounted && <td className="py-2 pr-2 text-right tabular-nums">{l.discountBp ? formatRate(l.discountBp) : ""}</td>}
                  {!franchise && <td className="py-2 pr-2 text-right tabular-nums">{formatRate(l.vatBp)}</td>}
                  <td className="py-2 text-right tabular-nums">{eur(lineNet(l))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-5 flex justify-end">
        <dl className="w-full space-y-1 sm:w-[46%]">
          <div className="flex justify-between gap-4">
            <dt>Total HT</dt>
            <dd className="tabular-nums">{eur(totals.netCents)}</dd>
          </div>
          {!franchise &&
            totals.bands.map((b) => (
              <div key={b.vatBp} className="flex justify-between gap-4 text-neutral-600">
                <dt>
                  TVA {formatRate(b.vatBp)} sur {eur(b.baseCents)}
                </dt>
                <dd className="tabular-nums">{eur(b.vatCents)}</dd>
              </div>
            ))}
          <div className="flex justify-between gap-4 border-t border-neutral-300 pt-1.5 text-[14px] font-semibold">
            <dt>{franchise ? "Total" : "Total TTC"}</dt>
            <dd className="tabular-nums">{eur(totals.grossCents)}</dd>
          </div>
          {kind === "invoice" && paid > 0 && !cancelled && (
            <>
              <div className="flex justify-between gap-4 text-neutral-600">
                <dt>Déjà réglé</dt>
                <dd className="tabular-nums">{eur(paid)}</dd>
              </div>
              <div className="flex justify-between gap-4 font-semibold">
                <dt>Reste à payer</dt>
                <dd className="tabular-nums">{eur(balanceOf(totals, payments))}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {content.notes && <p className="mt-6 whitespace-pre-line">{content.notes}</p>}

      {issuer && (
        <ul className="mt-6 space-y-0.5 text-[10.5px] text-neutral-600">
          {mentionsOf({ kind, number, content }, issuer, client).map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}

      {issuer?.footer && <footer className="mt-6 whitespace-pre-line border-t border-neutral-200 pt-3 text-center text-[10px] text-neutral-500">{issuer.footer}</footer>}
    </article>
  );
}
