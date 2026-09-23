/**
 * The LifeOS mark for generated images — the app icon, the home-screen icon.
 * The same glyph as the sidebar (Lucide's "sparkles"), on the product's
 * background, drawn as plain SVG so `next/og` can render it to PNG.
 *
 * Full-bleed background, glyph inside the central 60%: safe as a "maskable"
 * icon, which Android crops to a circle or a squircle.
 */

const SPARKLES = [
  "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
  "M20 3v4",
  "M22 5h-4",
  "M4 17v2",
  "M5 18H3",
];

export const BRAND_BACKGROUND = "#0A0A0B";

export function BrandMark({ size }: { size: number }) {
  const tile = Math.round(size * 0.6);
  const glyph = Math.round(tile * 0.62);
  return (
    <div
      style={{
        width: size,
        height: size,
        background: BRAND_BACKGROUND,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: tile,
          height: tile,
          borderRadius: Math.round(tile * 0.24),
          background: "#FAFAFA",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke={BRAND_BACKGROUND} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {SPARKLES.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </div>
    </div>
  );
}
