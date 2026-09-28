"use client";

import { useMemo, useState } from "react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { plural } from "@/lib/i18n/config";

const DAYS = 14;

/** The day key of an instant on this browser's clock ("2026-09-28"). */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Notes captured per day, the last fourteen days — one series, so no legend:
 * the title says what it is. Counted on the reader's own calendar (the
 * server does not know it), from the notes' creation times only.
 *
 * Columns grow from one baseline, square there and rounded at the top, never
 * wider than 24px, with air between them; the busiest day is labelled, the
 * rest are in the hover and in the table read to screen readers.
 */
export function CaptureChart({ createdAt }: { createdAt: string[] }) {
  const m = useMessages();
  const d = m.dashboard;
  const locale = useLocale();
  const tag = locale === "fr" ? "fr-FR" : "en-GB";
  const [hover, setHover] = useState<number | null>(null);

  const days = useMemo(() => {
    const today = new Date();
    const keys: { key: string; date: Date }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      keys.push({ key: dayKey(date), date });
    }
    const counts = new Map(keys.map((k) => [k.key, 0]));
    for (const iso of createdAt) {
      const k = dayKey(new Date(iso));
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return keys.map((k) => ({ ...k, n: counts.get(k.key) ?? 0 }));
  }, [createdAt]);

  const total = days.reduce((s, x) => s + x.n, 0);
  const max = Math.max(1, ...days.map((x) => x.n));
  const peak = days.reduce((best, x, i) => (x.n > days[best].n ? i : best), 0);
  const label = (x: { date: Date }) => new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short" }).format(x.date);

  // Geometry, in the SVG's own units.
  const W = 320;
  const H = 96;
  const slot = W / DAYS;
  const bar = Math.min(18, slot - 2);
  const top = 16;

  return (
    <figure className="px-5 pb-4 pt-3">
      <figcaption>
        <span className="block text-sm font-medium tracking-tight">{d.captures}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">
          {d.capturesRange} · {plural(locale, total, d.capturesTotal)}
        </span>
      </figcaption>

      {/* Capped width: the columns never grow past 24px on a wide screen. */}
      <div className="relative mt-4 max-w-[26rem] [container-type:inline-size]">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" aria-hidden>
          {/* Baseline: a hairline, recessive. */}
          <line x1={0} x2={W} y1={H} y2={H} stroke="hsl(var(--border-strong))" strokeWidth={1} />
          {days.map((x, i) => {
            const h = x.n === 0 ? 0 : Math.max(3, ((H - top) * x.n) / max);
            const cx = i * slot + slot / 2;
            const y = H - h;
            const r = Math.min(4, h / 2, bar / 2);
            // Rounded at the data end, square at the baseline.
            const path =
              h > 0
                ? `M${cx - bar / 2},${H} V${y + r} Q${cx - bar / 2},${y} ${cx - bar / 2 + r},${y} H${cx + bar / 2 - r} Q${cx + bar / 2},${y} ${cx + bar / 2},${y + r} V${H} Z`
                : "";
            const active = hover === i;
            return (
              <g key={x.key}>
                {path && <path d={path} fill="hsl(var(--accent))" opacity={hover === null || active ? 1 : 0.45} />}
                {/* Hit target: the whole column of the slot, taller than the mark. */}
                <rect
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={H}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>

        {/* Labels in HTML, not in the SVG: they keep the text size whatever the
            chart's width. The busiest day's count sits on its column: the
            peak's top is `top` SVG units below the SVG's top edge. */}
        {days[peak].n > 0 && hover === null && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full text-[0.7rem] tabular-nums text-muted-foreground"
            style={{ left: `${((peak + 0.5) / DAYS) * 100}%`, top: `calc(${(top / W) * 100}cqw - 2px)` }}
          >
            {days[peak].n}
          </span>
        )}
        <div className="mt-1 flex justify-between text-[0.7rem] text-muted">
          <span>{label(days[0])}</span>
          <span>{label(days[DAYS - 1])}</span>
        </div>

        {hover !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface-2 px-2 py-1 text-[0.75rem] shadow-lift"
            style={{ left: `${((hover + 0.5) / DAYS) * 100}%` }}
          >
            {plural(locale, days[hover].n, d.capturesDay, { date: label(days[hover]) })}
          </div>
        )}
      </div>

      {/* The same figures as a table, for screen readers. */}
      <table className="sr-only">
        <caption>
          {d.captures} · {d.capturesRange}
        </caption>
        <tbody>
          {days.map((x) => (
            <tr key={x.key}>
              <th scope="row">{label(x)}</th>
              <td>{x.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
