"use client";

import { useState } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { dayNumber, type Metric, type Pattern, type RhythmSummary } from "@/lib/self/rhythm";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";

/**
 * Colours validated for both themes (dataviz palette checks: lightness band,
 * chroma, colour-blind separation, 3:1 against the surface). Identity never
 * rests on colour alone: a legend, a label at each line's end, and a table.
 */
export const METRIC_COLOR: Record<Metric, string> = { mood: "#d97706", energy: "#0284c7" };

const W = 320;
const H = 104;
const PAD = { l: 16, r: 44, t: 8, b: 16 };

function Chart({ summary, today }: { summary: RhythmSummary; today: string }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.rhythm;
  const [hover, setHover] = useState<number | null>(null);
  const end = dayNumber(today);
  // From the first day there is something to show (a week at least), not an empty month.
  const first = summary.series.length ? dayNumber(summary.series[0].day) : end - 29;
  const start = Math.min(end - 6, Math.max(end - 29, first));
  const x = (day: string) => PAD.l + ((dayNumber(day) - start) / Math.max(1, end - start)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((5 - v) / 4) * (H - PAD.t - PAD.b);
  const fmtDay = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(dayNumber(day) * 86_400_000));

  // Lines join consecutive days only: a gap in the check-ins stays a gap.
  const path = (metric: Metric) => {
    let d = "";
    let prev: number | null = null;
    for (const p of summary.series) {
      const v = p[metric];
      if (v === null) {
        prev = null;
        continue;
      }
      const n = dayNumber(p.day);
      d += `${prev !== null && n - prev === 1 ? "L" : "M"}${x(p.day).toFixed(1)},${y(v).toFixed(1)} `;
      prev = n;
    }
    return d.trim();
  };
  const lastOf = (metric: Metric) => [...summary.series].reverse().find((p) => p[metric] !== null);
  const point = hover !== null ? summary.series[hover] : null;

  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[27rem]" role="img" aria-label={t.chart}>
        {[1, 3, 5].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="2 3" />
            <text x={4} y={y(v) + 3} fontSize={8} fill="currentColor" fillOpacity={0.5}>
              {v}
            </text>
          </g>
        ))}
        {(["mood", "energy"] as const).map((metric) => {
          const last = lastOf(metric);
          return (
            <g key={metric} color={METRIC_COLOR[metric]}>
              <path d={path(metric)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {summary.series.map((p, i) =>
                p[metric] === null ? null : <circle key={p.day} cx={x(p.day)} cy={y(p[metric]!)} r={hover === i ? 4 : 2.6} fill="currentColor" stroke="hsl(var(--surface))" strokeWidth={1.5} />
              )}
              {last && (
                <text x={x(last.day) + 7} y={y(last[metric]!) + 3} fontSize={8.5} fill="currentColor" fontWeight={600}>
                  {metric === "mood" ? t.mood : t.energy}
                </text>
              )}
            </g>
          );
        })}
        {/* Hit areas wider than the marks. */}
        {summary.series.map((p, i) => (
          <rect
            key={p.day}
            x={x(p.day) - 5}
            y={0}
            width={10}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <figcaption className="flex min-h-[1.25rem] flex-wrap items-center gap-x-3 text-[0.72rem] text-muted-foreground">
        {point ? (
          <span>
            {fmtDay(point.day)} —{" "}
            {[
              point.mood !== null ? `${t.mood} ${new Intl.NumberFormat(locale).format(point.mood)}` : null,
              point.energy !== null ? `${t.energy} ${new Intl.NumberFormat(locale).format(point.energy)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : (
          (["mood", "energy"] as const).map((metric) => (
            <span key={metric} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: METRIC_COLOR[metric] }} />
              {metric === "mood" ? t.mood : t.energy}
            </span>
          ))
        )}
      </figcaption>
      <table className="sr-only">
        <caption>{t.chart}</caption>
        <thead>
          <tr>
            <th scope="col">—</th>
            <th scope="col">{t.mood}</th>
            <th scope="col">{t.energy}</th>
          </tr>
        </thead>
        <tbody>
          {summary.series.map((p) => (
            <tr key={p.day}>
              <th scope="row">{fmtDay(p.day)}</th>
              <td>{p.mood === null ? "—" : new Intl.NumberFormat(locale).format(p.mood)}</td>
              <td>{p.energy === null ? "—" : new Intl.NumberFormat(locale).format(p.energy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function RhythmPanel({ summary, today }: { summary: RhythmSummary; today: string }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.rhythm;
  const num = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v);
  const keyName = (key: string) => (/^\d$/.test(key) ? t.weekdays[Number(key)] : t.parts[key as keyof typeof t.parts] ?? key);
  const patternText = (p: Pattern) =>
    fill(t.pattern, {
      metric: p.metric === "mood" ? t.mood : t.energy,
      best: keyName(p.best.key),
      bestMean: num(p.best.mean),
      worst: keyName(p.worst.key),
      worstMean: num(p.worst.mean),
    });
  const patterns = [...summary.parts, ...summary.weekdays];
  const hasWeek = summary.week.mood.recent || summary.week.energy.recent;

  return (
    <section aria-labelledby="rhythm-title" className="rounded-xl border border-border bg-surface p-5">
      <h2 id="rhythm-title" className="text-[0.95rem] font-medium">
        {t.title}
      </h2>
      <p className="mt-0.5 text-[0.74rem] text-muted-foreground">{t.hint}</p>
      {summary.count === 0 ? (
        <p className="mt-3 text-[0.8rem] text-muted-foreground">{t.notEnough}</p>
      ) : (
        <>
          {summary.series.length > 1 && <Chart summary={summary} today={today} />}
          {hasWeek && (
            <div className="mt-3">
              <p className="text-[0.7rem] uppercase tracking-wider text-muted">{t.week}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {(["mood", "energy"] as const).map((metric) => {
                  const w = summary.week[metric];
                  if (!w.recent) return null;
                  const Trend = w.trend === "up" ? TrendingUp : w.trend === "down" ? TrendingDown : Minus;
                  return (
                    <li key={metric} className="flex items-center gap-2 text-[0.8rem]">
                      <span className="h-2 w-2 rounded-full" style={{ background: METRIC_COLOR[metric] }} aria-hidden />
                      <span className="w-14 text-muted-foreground">{metric === "mood" ? t.mood : t.energy}</span>
                      <span className="font-mono tabular-nums">{num(w.recent.mean)}/5</span>
                      <span className="text-[0.72rem] text-muted-foreground">{plural(locale, w.recent.n, t.basis)}</span>
                      {w.trend && (
                        <span className="inline-flex items-center gap-1 text-[0.72rem] text-muted-foreground">
                          <Trend className="h-3 w-3" /> {t[w.trend]}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {patterns.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1">
              {patterns.map((p) => (
                <li key={`${p.metric}-${p.best.key}-${p.worst.key}`} className="text-[0.8rem] leading-snug">
                  {patternText(p)}{" "}
                  <span className="text-[0.7rem] text-muted-foreground">
                    ({plural(locale, p.best.n + p.worst.n, t.basis)})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            summary.count < 12 && <p className="mt-3 text-[0.76rem] text-muted-foreground">{t.notEnough}</p>
          )}
        </>
      )}
    </section>
  );
}
