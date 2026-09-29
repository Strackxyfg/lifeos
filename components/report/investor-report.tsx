"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Printer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { investorReport, lastCompleteMonth, type ReportInput } from "@/lib/report/investor";
import { addMonths } from "@/lib/finance/treasury";
import { day, money, monthName } from "@/components/finance/treasury";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The monthly investor update: key figures with numbered sources, the
 * pipeline and projects as they stand, the month's highlights, decisions
 * and asks from the Friday reviews. Copied as Markdown, or printed.
 */
export function InvestorReportView({ input }: { input: ReportInput }) {
  const m = useMessages();
  const locale = useLocale();
  const r = m.founder.report;
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localToday()), []);
  const [month, setMonth] = useState<string | null>(null);
  const [intro, setIntro] = useState("");
  useEffect(() => {
    if (today && !month) setMonth(lastCompleteMonth(today));
  }, [today, month]);

  const months = useMemo(() => {
    if (!today) return [];
    const dated = input.transactions.map((t) => t.occurredOn).filter(Boolean) as string[];
    const first = dated.length ? dated.sort()[0].slice(0, 7) : lastCompleteMonth(today);
    const out: string[] = [];
    for (let mo = lastCompleteMonth(today); mo >= first && out.length < 36; mo = addMonths(mo, -1)) out.push(mo);
    if (!out.length) out.push(lastCompleteMonth(today));
    return out;
  }, [input.transactions, today]);

  const report = useMemo(() => (month ? investorReport(input, month) : null), [input, month]);
  const txnName = useMemo(() => new Map(input.transactions.map((t) => [t.id, t.item])), [input.transactions]);
  if (!report || !month) return <div className="h-40" aria-busy />;

  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 })} %`;
  const label = monthName(month, locale);
  const monthLabel = label.charAt(0).toUpperCase() + label.slice(1);
  const reviewLabel = (w: string) => fill(r.sourceReview, { date: day(w, locale) });

  // Sources, numbered in the order they are cited.
  const sources: string[] = [];
  const cite = (text: string) => {
    const i = sources.indexOf(text);
    if (i >= 0) return i + 1;
    sources.push(text);
    return sources.length;
  };
  const txnSource = (ids: string[], mo: string) =>
    `${plural(locale, ids.length, r.sourceTxns, { month: monthName(mo, locale) })}${ids.length ? ` — ${ids.map((id) => txnName.get(id)).join(", ")}` : ""}`;

  // `text`: a sentence rather than a figure, set in the text face.
  const rows: { label: string; value: string; note?: number; text?: boolean }[] = [
    { label: r.revenue, value: money(report.revenue.value, locale), note: cite(txnSource(report.revenue.ids, month)) },
    { label: r.expenses, value: money(report.expenses.value, locale), note: cite(txnSource(report.expenses.ids, month)) },
    { label: r.net, value: money(report.net, locale) },
    {
      label: r.growth,
      value: report.growth === null ? (report.previousRevenue ? r.notAvailable : r.noPrevious) : pct(report.growth),
      note: report.previousRevenue ? cite(txnSource(report.previousRevenue.ids, addMonths(month, -1))) : undefined,
    },
    {
      label: r.cashEnd,
      value: report.cashEnd ? money(report.cashEnd.value, locale) : r.notAvailable,
      note: report.cashEnd ? cite(fill(r.sourceBalance, { amount: money(report.cashEnd.anchor.amount, locale), date: day(report.cashEnd.anchor.asOf, locale) })) : undefined,
    },
    {
      label: r.runwayEnd,
      text: true,
      value:
        report.runwayEnd === "growing"
          ? m.founder.treasury.growing
          : report.runwayEnd
            ? fill(m.founder.treasury.runwayMonths, { n: report.runwayEnd.months.toLocaleString(locale === "fr" ? "fr-FR" : "en-US"), month: monthName(report.runwayEnd.endsIn, locale) })
            : r.notAvailable,
    },
  ];
  const dealsNote = cite(plural(locale, input.deals.length, r.sourceDeals));
  const projectsNote = cite(plural(locale, input.projects.length, r.sourceProjects));
  const reviewWeeks = [...new Set([...report.highlights, ...report.decisions, ...report.blockers].map((x) => x.weekStart))];
  const reviewNotes = Object.fromEntries(reviewWeeks.map((w) => [w, cite(reviewLabel(w))]));

  const markdown = () => {
    const lines: string[] = [`# ${r.title} — ${monthLabel}`, ""];
    if (intro.trim()) lines.push(intro.trim(), "");
    lines.push(`## ${r.metrics}`, "");
    for (const row of rows) lines.push(`- **${row.label}**: ${row.value}${row.note ? ` [${row.note}]` : ""}`);
    lines.push("", `## ${r.pipeline} [${dealsNote}]`, "");
    lines.push(`- ${plural(locale, report.pipeline.open.count, r.openDeals, { value: money(report.pipeline.open.value, locale) })}`);
    lines.push(`- ${plural(locale, report.pipeline.won.count, r.wonDeals, { value: money(report.pipeline.won.value, locale) })}`);
    lines.push("", `## ${r.projects} [${projectsNote}]`, "");
    for (const p of report.projects.active) lines.push(`- ${p.name} — ${p.progress} %`);
    if (report.highlights.length) {
      lines.push("", `## ${r.highlights}`, "");
      for (const h of report.highlights) lines.push(`- ${h.wins.replace(/\n+/g, " ")} [${reviewNotes[h.weekStart]}]`);
    }
    if (report.decisions.length) {
      lines.push("", `## ${r.decisions}`, "");
      for (const d of report.decisions) lines.push(`- ${d.text}${d.why ? ` — ${d.why}` : ""} [${reviewNotes[d.weekStart]}]`);
    }
    if (report.blockers.length) {
      lines.push("", `## ${r.blockers}`, "");
      for (const b of report.blockers) lines.push(`- ${b.text.replace(/\n+/g, " ")} [${reviewNotes[b.weekStart]}]`);
    }
    if (report.undated > 0) lines.push("", `_${plural(locale, report.undated, r.undatedWarning)}_`);
    lines.push("", `## ${r.sources}`, "", ...sources.map((s, i) => `${i + 1}. ${s}`));
    return lines.join("\n");
  };

  const Note = ({ n }: { n?: number }) => (n ? <sup className="ml-0.5 text-[0.65rem] text-accent">[{n}]</sup> : null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="block">
          <span className="mb-1 block text-[0.72rem] text-muted-foreground">{r.month}</span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-border bg-surface-2/60 px-2.5 text-sm capitalize outline-none focus:border-border-strong"
          >
            {months.map((mo) => (
              <option key={mo} value={mo}>
                {monthName(mo, locale)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(markdown());
              toast(r.copied);
            } catch {
              toast(m.founder.errors.failed, "error");
            }
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.8125rem] text-muted-foreground hover:text-foreground"
        >
          <ClipboardCopy className="h-4 w-4" aria-hidden />
          {r.copy}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.8125rem] text-muted-foreground hover:text-foreground"
        >
          <Printer className="h-4 w-4" aria-hidden />
          {r.print}
        </button>
      </div>

      <label className="block print:hidden">
        <span className="mb-1 block text-[0.72rem] text-muted-foreground">{r.intro}</span>
        <textarea
          rows={3}
          value={intro}
          placeholder={r.introHint}
          onChange={(e) => setIntro(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-border-strong"
        />
      </label>

      <Card id="investor-report" className="p-6">
        <h2 className="text-lg font-semibold">{`${r.title} — ${monthLabel}`}</h2>
        {intro.trim() && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{intro.trim()}</p>}

        <h3 className="mt-6 text-sm font-semibold">{r.metrics}</h3>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="py-2 text-muted-foreground">{row.label}</td>
                <td className={cn("py-2 text-right", row.text || row.value === r.notAvailable || row.value === r.noPrevious ? "font-sans" : "font-mono", (row.value === r.notAvailable || row.value === r.noPrevious) && "text-muted")}>
                  {row.value}
                  <Note n={row.note} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {report.undated > 0 && <p className="mt-2 text-[0.8125rem] text-warning">{plural(locale, report.undated, r.undatedWarning)}</p>}

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold">
              {r.pipeline}
              <Note n={dealsNote} />
            </h3>
            <p className="mt-1 text-[0.72rem] text-muted">{r.pipelineNote}</p>
            <ul className="mt-2 space-y-1 text-sm">
              <li>{plural(locale, report.pipeline.open.count, r.openDeals, { value: money(report.pipeline.open.value, locale) })}</li>
              <li>{plural(locale, report.pipeline.won.count, r.wonDeals, { value: money(report.pipeline.won.value, locale) })}</li>
            </ul>
          </section>
          <section>
            <h3 className="text-sm font-semibold">
              {r.projects}
              <Note n={projectsNote} />
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              {report.projects.active.map((p) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span>{p.name}</span>
                  <span className="font-mono text-muted-foreground">{p.progress} %</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-6">
          <h3 className="text-sm font-semibold">{r.highlights}</h3>
          <p className="text-[0.72rem] text-muted">{r.highlightsNote}</p>
          {report.highlights.length === 0 ? (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">{r.noHighlights}</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {report.highlights.map((h) => (
                <li key={h.weekStart} className="whitespace-pre-line">
                  {h.wins}
                  <Note n={reviewNotes[h.weekStart]} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {report.decisions.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-semibold">{r.decisions}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {report.decisions.map((d, i) => (
                <li key={i}>
                  {d.text}
                  {d.why && <span className="text-muted-foreground"> — {d.why}</span>}
                  <Note n={reviewNotes[d.weekStart]} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.blockers.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-semibold">{r.blockers}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {report.blockers.map((b) => (
                <li key={b.weekStart} className="whitespace-pre-line">
                  {b.text}
                  <Note n={reviewNotes[b.weekStart]} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 border-t border-border pt-4">
          <h3 className="text-[0.8125rem] font-semibold">{r.sources}</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[0.75rem] text-muted-foreground">
            {sources.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      </Card>
    </div>
  );
}
