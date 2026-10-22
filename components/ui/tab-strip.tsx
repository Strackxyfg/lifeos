"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A row of tabs that never pushes the page sideways: when it is wider than
 * the screen it scrolls on its own, and it works with every hand on it.
 *
 *  - Finger: native momentum scrolling, contained (no page bounce).
 *  - Mouse wheel: an ordinary vertical wheel moves it sideways while it can
 *    still move that way, then lets the page scroll — a hidden scrollbar is
 *    otherwise unreachable with a mouse.
 *  - Mouse without a wheel: arrows at the edges that have more.
 *  - Keyboard: ← → Home End go from tab to tab.
 *  - The current tab (`aria-current="page"` or `aria-selected="true"`) is
 *    always brought into view, without moving the page.
 *  - The edges fade where there is more to see.
 */
export function TabStrip({
  children,
  className,
  scrollerClassName,
  role,
  label,
  activeKey,
}: {
  children: React.ReactNode;
  /** The frame (border, background, margins). */
  className?: string;
  /** The row of tabs itself (gaps). */
  scrollerClassName?: string;
  /** "tablist" for tabs that switch a panel; leave it out for links. */
  role?: "tablist";
  label?: string;
  /** Changes when the current tab does, to bring it into view. */
  activeKey?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft < max - 1;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);

  // The current tab in view, the page left where it is.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
    if (current) {
      const margin = 28;
      const left = current.offsetLeft;
      const right = left + current.offsetWidth;
      if (left - margin < el.scrollLeft) el.scrollLeft = Math.max(0, left - margin);
      else if (right + margin > el.scrollLeft + el.clientWidth) el.scrollLeft = right + margin - el.clientWidth;
    }
    measure();
  }, [activeKey, measure]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    // A vertical wheel moves the row while it can; at its ends the page scrolls as usual.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      if ((delta < 0 && el.scrollLeft <= 0) || (delta > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure]);

  const page = (dir: -1 | 1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
    items[next].focus();
  };

  const fade = 24;
  const mask =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? "transparent 0, #000 " + fade + "px" : "#000 0"}, ${edges.end ? "#000 calc(100% - " + fade + "px), transparent 100%" : "#000 100%"})`
      : undefined;

  return (
    <div className={cn("relative flex min-w-0", className)}>
      <div
        ref={scroller}
        role={role}
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn("relative flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", scrollerClassName)}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
      {edges.start && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => page(-1)}
          className="absolute inset-y-0 left-0 hidden w-7 place-items-center text-muted-foreground transition-colors hover:text-foreground [@media(pointer:fine)]:grid"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {edges.end && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => page(1)}
          className="absolute inset-y-0 right-0 hidden w-7 place-items-center text-muted-foreground transition-colors hover:text-foreground [@media(pointer:fine)]:grid"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
