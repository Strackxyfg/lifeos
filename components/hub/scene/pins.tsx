"use client";

import { Html } from "@react-three/drei";
import { DISTRICTS, type DistrictId } from "@/lib/hub/districts";
import { DISTRICT_ICONS } from "../district-icons";

export interface PinLabel {
  name: string;
  /** Spoken by screen readers: the name and what waits there. */
  aria: string;
}

/**
 * A marker over each building, as in a game's world map: its pictogram, its
 * name on hover, and a count when something waits there. They are real
 * buttons — reachable with Tab, announced by screen readers — so the island
 * is usable without ever touching the 3D scene.
 */
export function Pins({
  labels,
  badges,
  hovered,
  visible,
  onHover,
  onSelect,
}: {
  labels: Record<DistrictId, PinLabel>;
  badges: Partial<Record<DistrictId, number>>;
  hovered: DistrictId | null;
  visible: boolean;
  onHover: (id: DistrictId | null) => void;
  onSelect: (id: DistrictId) => void;
}) {
  return (
    <>
      {DISTRICTS.map((d) => {
        const Icon = DISTRICT_ICONS[d.id];
        const count = badges[d.id] ?? 0;
        const open = hovered === d.id;
        return (
          <Html
            key={d.id}
            position={[d.at[0], d.height + 1.15, d.at[1]]}
            center
            zIndexRange={[30, 10]}
            style={{
              pointerEvents: visible ? "auto" : "none",
              opacity: visible ? 1 : 0,
              transition: "opacity 220ms ease",
            }}
          >
            <button
              type="button"
              tabIndex={visible ? 0 : -1}
              aria-label={labels[d.id].aria}
              // The scene listens on the same element: keep the press to the
              // marker, or it would also pick whatever building is behind it.
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(d.id);
              }}
              onPointerEnter={() => onHover(d.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(d.id)}
              onBlur={() => onHover(null)}
              // Under a finger, the marker answers a little beyond its edge:
              // 44 px, the size a fingertip needs, without drawing it larger.
              className="group relative flex touch-manipulation select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-[rgba(12,16,28,0.55)] py-1 pl-1 pr-1 text-[0.75rem] font-medium text-white shadow-[0_6px_24px_-6px_rgba(0,0,0,0.55)] backdrop-blur-md transition-[padding,background-color,transform] duration-200 [-webkit-tap-highlight-color:transparent] hover:bg-[rgba(12,16,28,0.72)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white data-[open=true]:pr-3 [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-1.5 [@media(pointer:coarse)]:before:rounded-full [@media(pointer:coarse)]:before:content-['']"
              data-open={open}
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span
                className="max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 data-[open=true]:max-w-[12rem] data-[open=true]:opacity-100"
                data-open={open}
              >
                {labels[d.id].name}
              </span>
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-[hsl(222_90%_60%)] px-1 text-[0.625rem] font-semibold leading-none text-white ring-2 ring-[rgba(12,16,28,0.55)]">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          </Html>
        );
      })}
    </>
  );
}
