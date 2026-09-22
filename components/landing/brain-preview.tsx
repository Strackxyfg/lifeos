"use client";

import { ArrowUp, Brain, Target } from "lucide-react";
import { categoryById, type BrainCategoryId } from "@/lib/data/brain";
import { useMessages } from "@/lib/i18n/client";

/**
 * The product as it looks, labelled as an example.
 *
 * It replaces a mock of a Notion page ("notion.so / quinn-s-lifeos") with MRR
 * and revenue figures, marked "Live" and "Generated in 47s". This shows what
 * LifeOS actually is — a map of notes and the focus list built from it — with
 * sample content, and says so. The map has exactly the note and connection
 * counts its header claims.
 */

interface Dot {
  x: number;
  y: number;
  region: BrainCategoryId;
}

/** Where each region clusters in the 400×300 frame. */
const CENTERS: Record<BrainCategoryId, [number, number]> = {
  goals: [205, 142],
  next: [305, 92],
  ideas: [98, 88],
  thoughts: [92, 214],
  knowledge: [304, 214],
  insights: [206, 256],
};

const COUNTS: [BrainCategoryId, number][] = [
  ["goals", 3],
  ["next", 6],
  ["ideas", 5],
  ["thoughts", 4],
  ["knowledge", 4],
  ["insights", 2],
];

/** Seeded, so the server and the browser draw the same picture. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DOTS: Dot[] = (() => {
  const r = rng(7);
  const out: Dot[] = [];
  for (const [region, n] of COUNTS) {
    const [cx, cy] = CENTERS[region];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.8;
      const d = i === 0 ? 0 : 20 + r() * 26;
      // Rounded: Math.cos may differ in the last bits between the server's
      // engine and the browser's, and any difference is a hydration mismatch.
      const round = (v: number) => Math.round(v * 10) / 10;
      out.push({ x: round(cx + Math.cos(a) * d), y: round(cy + Math.sin(a) * d * 0.8), region });
    }
  }
  return out;
})();

/** Index of the i-th dot of a region. */
const at = (region: BrainCategoryId, i: number) =>
  DOTS.findIndex((d, k) => d.region === region && DOTS.slice(0, k).filter((x) => x.region === region).length === i);

/** Eleven connections, as the header says: steps and ideas lead to goals. */
const EDGES: [number, number][] = [
  [at("next", 0), at("goals", 0)],
  [at("next", 1), at("goals", 0)],
  [at("next", 2), at("goals", 1)],
  [at("next", 3), at("goals", 2)],
  [at("ideas", 0), at("goals", 0)],
  [at("ideas", 1), at("next", 4)],
  [at("knowledge", 0), at("next", 1)],
  [at("knowledge", 1), at("next", 5)],
  [at("thoughts", 0), at("ideas", 2)],
  [at("thoughts", 1), at("insights", 0)],
  [at("insights", 0), at("goals", 0)],
];

const GOAL = at("goals", 0);

export function BrainPreview() {
  const m = useMessages();
  const t = m.landing.preview;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-lift">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
        </div>
        <span className="mx-auto text-[0.7rem] text-muted-foreground">LifeOS · {t.title}</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[0.62rem] uppercase tracking-wider text-muted-foreground">
          {t.example}
        </span>
      </div>

      <div className="grid md:grid-cols-[1.15fr_1fr]">
        <div className="relative border-b border-border bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.08),transparent_70%)] md:border-b-0 md:border-r">
          <div className="absolute left-4 top-3 z-10">
            <p className="flex items-center gap-1.5 text-[0.75rem] font-medium">
              <Brain className="h-3.5 w-3.5 text-accent" /> {t.title}
            </p>
            <p className="font-mono text-[0.65rem] text-muted-foreground">{t.stats}</p>
          </div>
          <svg viewBox="0 0 400 300" className="h-[240px] w-full md:h-[330px]" role="img" aria-label={t.stats}>
            <g stroke="currentColor" className="text-accent" strokeOpacity={0.35} strokeWidth={1}>
              {EDGES.map(([a, b], i) => (
                <line key={i} x1={DOTS[a].x} y1={DOTS[a].y} x2={DOTS[b].x} y2={DOTS[b].y} />
              ))}
            </g>
            {DOTS.map((d, i) => {
              const color = categoryById(d.region).color;
              const r = i === GOAL ? 9 : d.region === "goals" ? 6 : 4.2;
              return (
                <g key={i}>
                  <circle cx={d.x} cy={d.y} r={r * 2.4} fill={color} opacity={0.08} />
                  <circle cx={d.x} cy={d.y} r={r} fill={color} opacity={0.95} />
                </g>
              );
            })}
            <text
              x={DOTS[GOAL].x}
              y={DOTS[GOAL].y + 24}
              textAnchor="middle"
              className="fill-foreground"
              style={{ fontSize: 10 }}
            >
              {t.goal.length > 34 ? `${t.goal.slice(0, 33)}…` : t.goal}
            </text>
          </svg>
        </div>

        <div className="flex flex-col p-4">
          <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-accent">
            <Target className="h-3.5 w-3.5" /> {t.focus}
          </p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {t.notes.map((n) => (
              <li key={n.title} className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-2/30 px-3 py-2">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: categoryById(n.region as BrainCategoryId).color }}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-[0.8rem] leading-snug">{n.title}</span>
                  <span className="mt-0.5 block text-[0.7rem] leading-snug text-muted-foreground">{n.reason}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-auto flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 pt-2 max-md:mt-4">
            <span className="flex-1 text-[0.78rem] text-muted">{t.capture}</span>
            <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background" aria-hidden>
              <ArrowUp className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
