"use client";

import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { BACKDROPS, DENSITIES, EDGES, FONTS, LAYOUTS, THEME_IDS, type MapDoc, type MapStyle } from "@/lib/maps/model";
import { THEMES, type FontFamilies } from "@/lib/maps/theme";
import { SwitchTrack } from "@/components/ui/switch";
import { Choice, Section, SidePanel } from "./ui";
import { themePreview } from "./preview";

/** Small drawings of each layout and branch style, for the choices. */
const LAYOUT_ICON: Record<MapStyle["layout"], React.ReactNode> = {
  map: (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <rect x="7.5" y="5.5" width="5" height="3" rx="1" fill="currentColor" stroke="none" />
      <path d="M12.5 7C15 7 15 3 18 3M12.5 7C15 7 15 11 18 11M7.5 7C5 7 5 3 2 3M7.5 7C5 7 5 11 2 11" />
    </svg>
  ),
  right: (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <rect x="1.5" y="5.5" width="5" height="3" rx="1" fill="currentColor" stroke="none" />
      <path d="M6.5 7C10 7 10 2.5 13 2.5H18M6.5 7H18M6.5 7C10 7 10 11.5 13 11.5H18" />
    </svg>
  ),
  down: (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <rect x="7.5" y="1" width="5" height="3" rx="1" fill="currentColor" stroke="none" />
      <path d="M10 4V7M3 12V7H17V12M10 7V12" />
    </svg>
  ),
};
const EDGE_ICON: Record<MapStyle["edge"], React.ReactNode> = {
  curve: <path d="M2 12C9 12 11 2 18 2" />,
  straight: <path d="M2 12L18 2" />,
  elbow: <path d="M2 12H8Q10 12 10 10V4Q10 2 12 2H18" />,
};

export function StylePanel({
  open,
  onClose,
  doc,
  families,
  onStyle,
  onLevels,
}: {
  open: boolean;
  onClose: () => void;
  doc: MapDoc;
  families: FontFamilies;
  onStyle: (patch: Partial<MapStyle>) => void;
  onLevels: (level: number) => void;
}) {
  const m = useMessages();
  const t = m.maps.style;
  const locale = useLocale();
  const style = doc.style;
  return (
    <SidePanel open={open} title={m.maps.editor.style} onClose={onClose} closeLabel={m.maps.inspector.close}>
      <Section title={t.theme}>
        <div role="radiogroup" aria-label={t.theme} className="grid grid-cols-2 gap-2">
          {THEME_IDS.map((id) => {
            const theme = THEMES[id];
            const on = style.theme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onStyle({ theme: id, font: theme.font })}
                className={cn(
                  "group overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
                  on ? "border-accent shadow-glow" : "border-border hover:border-border-strong"
                )}
              >
                <span className="block aspect-[16/10] overflow-hidden" style={{ background: theme.background }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG drawn here */}
                  <img
                    src={themePreview({ ...style, theme: id, layout: "map", backdrop: "plain" }, families)}
                    alt=""
                    className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.04]"
                    draggable={false}
                  />
                </span>
                <span className="flex items-center justify-between gap-1 px-2.5 py-1.5">
                  <span className="text-[0.75rem] font-medium">{theme.name[locale]}</span>
                  <span className="flex -space-x-1">
                    {theme.palette.slice(0, 4).map((c, i) => (
                      <span key={i} className="h-2.5 w-2.5 rounded-full ring-1 ring-surface" style={{ background: c }} />
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t.layout}>
        <Choice label={t.layout} value={style.layout} options={LAYOUTS.map((v) => ({ value: v, label: t.layouts[v], icon: LAYOUT_ICON[v] }))} onChange={(v) => onStyle({ layout: v })} />
      </Section>

      <Section title={t.edge}>
        <Choice
          label={t.edge}
          value={style.edge}
          options={EDGES.map((v) => ({
            value: v,
            label: t.edges[v],
            icon: (
              <svg viewBox="0 0 20 14" className="h-3.5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                {EDGE_ICON[v]}
              </svg>
            ),
          }))}
          onChange={(v) => onStyle({ edge: v })}
        />
      </Section>

      <Section title={t.font}>
        <div role="radiogroup" aria-label={t.font} className="grid grid-cols-3 gap-1.5">
          {FONTS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={style.font === f}
              onClick={() => onStyle({ font: f })}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg border py-2 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
                style.font === f ? "border-accent bg-accent/10" : "border-border hover:border-border-strong"
              )}
            >
              <span className="text-[1.25rem] leading-none" style={{ fontFamily: families[f] }}>
                Aa
              </span>
              <span className="text-[0.6875rem] text-muted-foreground">{t.fonts[f]}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t.density}>
        <Choice label={t.density} value={style.density} options={DENSITIES.map((v) => ({ value: v, label: t.densities[v] }))} onChange={(v) => onStyle({ density: v })} />
      </Section>

      <Section title={t.backdrop}>
        <Choice label={t.backdrop} value={style.backdrop} options={BACKDROPS.map((v) => ({ value: v, label: t.backdrops[v] }))} onChange={(v) => onStyle({ backdrop: v })} />
      </Section>

      <Section title={t.rainbow}>
        <button
          type="button"
          role="switch"
          aria-checked={style.rainbow}
          aria-label={t.rainbow}
          onClick={() => onStyle({ rainbow: !style.rainbow })}
          className="flex w-full items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80"
        >
          <span className="flex gap-1">
            {(style.rainbow ? THEMES[style.theme].palette.slice(0, 6) : Array(6).fill(THEMES[style.theme].accent)).map((c: string, i: number) => (
              <span key={i} className="h-3 w-3 rounded-full" style={{ background: c }} />
            ))}
          </span>
          <SwitchTrack on={style.rainbow} />
        </button>
      </Section>

      <Section title={t.levels}>
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onLevels(n)}
              className="rounded-lg border border-border py-1.5 text-[0.75rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80"
            >
              {n === 0 ? t.levelAll : fill(t.level, { n })}
            </button>
          ))}
        </div>
      </Section>
    </SidePanel>
  );
}
