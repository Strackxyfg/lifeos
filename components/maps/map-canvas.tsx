"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isInside, label, parentOf, type MapDoc } from "@/lib/maps/model";
import type { Box, Edge, Layout } from "@/lib/maps/layout";
import { BADGE_RADIUS, EMOJI_FONT, ICON_PATHS, IMAGE_RADIUS, badgeInk, badgeText, baseline, cornerOf, emojiBaseline, iconColor } from "@/lib/maps/draw";
import { imageUrl } from "./client";
import { cn } from "@/lib/utils";

/**
 * The map on screen: the same drawing as the exports (`lib/maps/svg.ts`,
 * `paint.ts`), made to be worked in. Moving and zooming change one
 * transform — nothing is re-rendered — so a large map stays fluid; ideas
 * are drawn once and only redrawn when they change.
 *
 *  - Mouse: click to select (Shift adds), double-click to edit, drag an idea
 *    to move it (onto another to make it a child, above or below to place
 *    it), drag the background to move around, wheel to scroll, Ctrl+wheel
 *    to zoom.
 *  - Touch: tap to select, double-tap to edit, hold an idea to move it, one
 *    finger to move around, two to zoom.
 *  - An image file dropped on an idea goes onto it.
 *
 * For screen readers it is a tree: each idea a tree item with its level,
 * whether it is open, and whether it is selected.
 */

export interface DropTarget {
  parent: string;
  index: number;
  side?: "left" | "right";
  mode: "child" | "before" | "after" | "side";
  /** The idea the drop is shown against. */
  ref: string;
}

export interface CanvasHandle {
  fit(animate?: boolean): void;
  zoomBy(factor: number): void;
  setZoom(k: number): void;
  /** Moves just enough for the idea to be on screen (clear of a panel covering `inset` of it). */
  reveal(id: string, inset?: { right?: number; bottom?: number }): void;
  center(id: string): void;
  focus(): void;
  /** Where an idea is on the screen (for placing a menu), in page pixels. */
  screenRect(id: string): DOMRect | null;
}

interface Props {
  doc: MapDoc;
  layout: Layout;
  selection: string[];
  editing: string | null;
  matches: Set<string>;
  current: string | null;
  treeLabel: string;
  editLabel: string;
  placeholder: string;
  onSelect(ids: string[]): void;
  onEdit(id: string): void;
  onText(id: string, text: string): void;
  onEditKey(e: React.KeyboardEvent<HTMLTextAreaElement>, id: string): void;
  onEditBlur(id: string): void;
  onToggle(id: string): void;
  onMove(id: string, target: DropTarget): void;
  onImage(id: string, file: File): void;
  onIcon(id: string, kind: "note" | "link" | "brain"): void;
  onZoom(k: number): void;
  onBackground(): void;
  onKeyDown(e: React.KeyboardEvent<SVGSVGElement>): void;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.08;
const MAX_K = 3;
const clampK = (k: number) => Math.max(MIN_K, Math.min(MAX_K, k));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; pointer: number; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "press"; pointer: number; id: string; sx: number; sy: number; touch: boolean; timer: ReturnType<typeof setTimeout> | null; additive: boolean }
  | { kind: "drag"; pointer: number; id: string; dx: number; dy: number }
  | { kind: "pinch"; d0: number; k0: number; mx: number; my: number; view: View };

export const MapCanvas = forwardRef<CanvasHandle, Props>(function MapCanvas(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const backdrop = useRef<SVGRectElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const size = useRef({ w: 1, h: 1 });
  const fitted = useRef(false);
  const anim = useRef<number | null>(null);
  const gesture = useRef<Gesture>({ kind: "none" });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  /** The idea the last press was on: a double-click lands on the canvas, which holds the pointer. */
  const pressed = useRef<string | null>(null);
  const target = useRef<DropTarget | null>(null);
  const props = useRef(p);
  props.current = p;

  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target: DropTarget | null } | null>(null);
  const [fileOver, setFileOver] = useState<string | null>(null);

  const theme = p.layout.theme;
  const ring = theme.dark ? "#60a5fa" : "#2563eb";

  /* ── The view ───────────────────────────────────────────────────── */

  const apply = useCallback(() => {
    const { x, y, k } = view.current;
    world.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
    if (overlay.current) overlay.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    const b = backdrop.current;
    if (b) {
      b.setAttribute("x", String(-x / k - 48));
      b.setAttribute("y", String(-y / k - 48));
      b.setAttribute("width", String(size.current.w / k + 96));
      b.setAttribute("height", String(size.current.h / k + 96));
    }
  }, []);

  const animateTo = useCallback(
    (to: View, ms = 260) => {
      if (anim.current) cancelAnimationFrame(anim.current);
      const from = { ...view.current };
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || ms <= 0) {
        view.current = to;
        apply();
        props.current.onZoom(to.k);
        return;
      }
      const start = performance.now();
      const step = (t: number) => {
        const e = easeOut(Math.min(1, (t - start) / ms));
        view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
        apply();
        if (e < 1) anim.current = requestAnimationFrame(step);
        else {
          anim.current = null;
          props.current.onZoom(to.k);
        }
      };
      anim.current = requestAnimationFrame(step);
    },
    [apply]
  );

  const fitView = useCallback((): View => {
    const b = props.current.layout.bounds;
    const { w, h } = size.current;
    const pad = Math.min(80, Math.max(24, Math.min(w, h) * 0.08));
    const k = clampK(Math.min((w - pad * 2) / Math.max(1, b.w), (h - pad * 2) / Math.max(1, b.h), 1.15));
    return { k, x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k };
  }, []);

  const zoomAt = useCallback(
    (k: number, cx: number, cy: number, animate = false) => {
      const v = view.current;
      const nk = clampK(k);
      const mx = (cx - v.x) / v.k;
      const my = (cy - v.y) / v.k;
      const to = { k: nk, x: cx - mx * nk, y: cy - my * nk };
      if (animate) animateTo(to, 180);
      else {
        view.current = to;
        apply();
        props.current.onZoom(nk);
      }
    },
    [animateTo, apply]
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: (animate = true) => (animate ? animateTo(fitView()) : ((view.current = fitView()), apply(), props.current.onZoom(view.current.k))),
      zoomBy: (f) => zoomAt(view.current.k * f, size.current.w / 2, size.current.h / 2, true),
      setZoom: (k) => zoomAt(k, size.current.w / 2, size.current.h / 2, true),
      reveal(id, inset = {}) {
        const b = props.current.layout.boxes.get(id);
        if (!b) return;
        const v = view.current;
        const m = 56;
        const w = size.current.w - (inset.right ?? 0);
        const h = size.current.h - (inset.bottom ?? 0);
        const sx = b.x * v.k + v.x;
        const sy = b.y * v.k + v.y;
        const sw = b.w * v.k;
        const sh = b.h * v.k;
        let dx = 0;
        let dy = 0;
        if (sx < m) dx = m - sx;
        else if (sx + sw > w - m) dx = Math.max(m - sx, w - m - (sx + sw));
        if (sy < m) dy = m - sy;
        else if (sy + sh > h - m) dy = Math.max(m - sy, h - m - (sy + sh));
        if (dx || dy) animateTo({ ...v, x: v.x + dx, y: v.y + dy }, 220);
      },
      center(id) {
        const b = props.current.layout.boxes.get(id);
        if (!b) return;
        const v = view.current;
        animateTo({ k: v.k, x: size.current.w / 2 - (b.x + b.w / 2) * v.k, y: size.current.h / 2 - (b.y + b.h / 2) * v.k });
      },
      focus: () => svg.current?.focus({ preventScroll: true }),
      screenRect(id) {
        const el = svg.current?.querySelector(`[data-node="${CSS.escape(id)}"] [data-shape]`);
        return el ? (el as SVGGraphicsElement).getBoundingClientRect() : null;
      },
    }),
    [animateTo, apply, fitView, zoomAt]
  );

  // Size, and the first fit once the size is known.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      size.current = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      if (!fitted.current && r.width > 0) {
        fitted.current = true;
        view.current = fitView();
        props.current.onZoom(view.current.k);
      }
      apply();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply, fitView]);

  // Wheel: scroll to move, Ctrl/⌘ (or a pinch on a trackpad) to zoom.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
        zoomAt(view.current.k * factor, e.clientX - r.left, e.clientY - r.top);
      } else {
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.current.h : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
        view.current = { ...view.current, x: view.current.x - dx, y: view.current.y - dy };
        apply();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, zoomAt]);

  /* ── Pointers ───────────────────────────────────────────────────── */

  const toMap = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    const v = view.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const nodeAt = (target: EventTarget | null): string | null => {
    const el = (target as Element | null)?.closest?.("[data-node]");
    return el?.getAttribute("data-node") ?? null;
  };

  /** Where an idea dragged to `pt` would go. */
  const dropAt = (pt: { x: number; y: number }, dragged: string): DropTarget | null => {
    const { doc, layout } = props.current;
    const vertical = doc.style.layout === "down";
    for (const id of layout.order) {
      if (id === dragged || isInside(doc, id, dragged)) continue;
      const b = layout.boxes.get(id)!;
      if (pt.x < b.x - 6 || pt.x > b.x + b.w + 6 || pt.y < b.y - 6 || pt.y > b.y + b.h + 6) continue;
      if (id === doc.root) return { parent: id, index: doc.nodes[id].children.length, mode: "child", ref: id };
      const t = vertical ? (pt.x - b.x) / b.w : (pt.y - b.y) / b.h;
      const parent = parentOf(doc, id);
      if (!parent) return null;
      const at = doc.nodes[parent].children.indexOf(id);
      const side = parent === doc.root ? (doc.nodes[id].side ?? (b.dir === "left" ? "left" : "right")) : undefined;
      if (t < 0.28) return { parent, index: at, mode: "before", ref: id, side };
      if (t > 0.72) return { parent, index: at + 1, mode: "after", ref: id, side };
      return { parent: id, index: doc.nodes[id].children.length, mode: "child", ref: id };
    }
    // Into open space beside the root, on a map: a main branch changes sides.
    const root = layout.boxes.get(doc.root)!;
    if (doc.style.layout === "map" && doc.nodes[doc.root].children.includes(dragged)) {
      const side = pt.x < root.x + root.w / 2 ? "left" : "right";
      return { parent: doc.root, index: doc.nodes[doc.root].children.length, mode: "side", ref: doc.root, side };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as Element).closest("[data-action]")) return;
    svg.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (anim.current) cancelAnimationFrame(anim.current);

    if (pointers.current.size === 2) {
      // A second finger: pinch to zoom (whatever the first one was doing).
      const g = gesture.current;
      if (g.kind === "press" && g.timer) clearTimeout(g.timer);
      setDrag(null);
      const [a, b] = [...pointers.current.values()];
      const r = svg.current!.getBoundingClientRect();
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), k0: view.current.k, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, view: { ...view.current } };
      return;
    }
    const id = nodeAt(e.target);
    pressed.current = id;
    if (id) {
      const touch = e.pointerType !== "mouse";
      const pressed: Gesture = { kind: "press", pointer: e.pointerId, id, sx: e.clientX, sy: e.clientY, touch, timer: null, additive: e.shiftKey || e.metaKey || e.ctrlKey };
      if (touch && id !== props.current.doc.root) {
        // Hold to move: a moment without moving, then the idea follows the finger.
        pressed.timer = setTimeout(() => {
          const g = gesture.current;
          if (g.kind !== "press" || g.id !== id) return;
          navigator.vibrate?.(12);
          startDrag(g.pointer, id, g.sx, g.sy);
        }, 380);
      }
      gesture.current = pressed;
    } else {
      gesture.current = { kind: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
    }
  };

  const startDrag = (pointer: number, id: string, sx: number, sy: number) => {
    const b = props.current.layout.boxes.get(id);
    if (!b) return;
    const pt = toMap(sx, sy);
    gesture.current = { kind: "drag", pointer, id, dx: pt.x - b.x, dy: pt.y - b.y };
    target.current = null;
    setDrag({ id, x: b.x, y: b.y, target: null });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === "none") {
      if (e.pointerType === "mouse") setHover(nodeAt(e.target));
      return;
    }
    if (g.kind === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const r = svg.current!.getBoundingClientRect();
      const k = clampK(g.k0 * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, g.d0)));
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const px = (g.mx - g.view.x) / g.view.k;
      const py = (g.my - g.view.y) / g.view.k;
      view.current = { k, x: mx - px * k, y: my - py * k };
      apply();
      return;
    }
    if (g.kind === "pan") {
      if (e.pointerId !== g.pointer) return;
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) > 3) g.moved = true;
      view.current = { ...view.current, x: g.vx + dx, y: g.vy + dy };
      apply();
      return;
    }
    if (g.kind === "press") {
      if (e.pointerId !== g.pointer) return;
      const moved = Math.hypot(e.clientX - g.sx, e.clientY - g.sy);
      if (g.touch) {
        // A finger that moves before the hold is up moves the map.
        if (moved > 8) {
          if (g.timer) clearTimeout(g.timer);
          gesture.current = { kind: "pan", pointer: g.pointer, sx: g.sx, sy: g.sy, vx: view.current.x, vy: view.current.y, moved: true };
        }
      } else if (moved > 5) {
        if (g.id === props.current.doc.root) gesture.current = { kind: "pan", pointer: g.pointer, sx: g.sx, sy: g.sy, vx: view.current.x, vy: view.current.y, moved: true };
        else startDrag(g.pointer, g.id, g.sx, g.sy);
      }
      return;
    }
    if (g.kind === "drag") {
      const pt = toMap(e.clientX, e.clientY);
      target.current = dropAt(pt, g.id);
      setDrag({ id: g.id, x: pt.x - g.dx, y: pt.y - g.dy, target: target.current });
      // Near an edge, the map scrolls under the idea.
      const r = svg.current!.getBoundingClientRect();
      const edge = 36;
      const sx = e.clientX - r.left < edge ? 8 : r.right - e.clientX < edge ? -8 : 0;
      const sy = e.clientY - r.top < edge ? 8 : r.bottom - e.clientY < edge ? -8 : 0;
      if (sx || sy) {
        view.current = { ...view.current, x: view.current.x + sx, y: view.current.y + sy };
        apply();
      }
    }
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>, cancelled = false) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === "pinch") {
      if (pointers.current.size === 0) {
        gesture.current = { kind: "none" };
        props.current.onZoom(view.current.k);
      }
      return;
    }
    gesture.current = { kind: "none" };
    if (g.kind === "pan") {
      if (!g.moved && !cancelled) props.current.onBackground();
      return;
    }
    if (g.kind === "press") {
      if (g.timer) clearTimeout(g.timer);
      if (cancelled) return;
      const { selection } = props.current;
      if (g.additive) {
        props.current.onSelect(selection.includes(g.id) ? selection.filter((s) => s !== g.id) : [...selection, g.id]);
        return;
      }
      // A second tap on the same idea, quickly: edit it.
      const now = performance.now();
      if (g.touch && lastTap.current && lastTap.current.id === g.id && now - lastTap.current.at < 320) {
        lastTap.current = null;
        props.current.onEdit(g.id);
        return;
      }
      lastTap.current = { id: g.id, at: now };
      props.current.onSelect([g.id]);
      return;
    }
    if (g.kind === "drag") {
      const to = target.current;
      target.current = null;
      setDrag(null);
      if (!cancelled && to) props.current.onMove(g.id, to);
    }
  };

  /* ── Files dropped on an idea ───────────────────────────────────── */

  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const pt = toMap(e.clientX, e.clientY);
    let over: string | null = null;
    for (const b of props.current.layout.boxes.values()) if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) over = b.id;
    setFileOver(over);
  };
  const onDrop = (e: React.DragEvent) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    const id = fileOver;
    setFileOver(null);
    if (!file || !id) return;
    e.preventDefault();
    props.current.onImage(id, file);
  };

  /* ── Drawing ────────────────────────────────────────────────────── */

  const selected = useMemo(() => new Set(p.selection), [p.selection]);
  const editingBox = p.editing ? p.layout.boxes.get(p.editing) : undefined;
  const dragging = drag ? p.layout.boxes.get(drag.id) : undefined;
  const indicator = drag?.target ? indicatorFor(drag.target, p.layout, p.doc) : null;
  const active = p.selection[0];

  return (
    <div ref={host} className="relative h-full w-full overflow-hidden" style={{ background: theme.background }}>
      <svg
        ref={svg}
        data-map-canvas=""
        role="tree"
        aria-label={p.treeLabel}
        aria-multiselectable="true"
        aria-activedescendant={active ? `mapnode-${active}` : undefined}
        tabIndex={0}
        className="block h-full w-full touch-none select-none outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e)}
        onPointerCancel={(e) => endPointer(e, true)}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => {
          const id = nodeAt(e.target) ?? pressed.current;
          if (id && p.doc.nodes[id]) p.onEdit(id);
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setFileOver(null)}
        onDrop={onDrop}
        onKeyDown={p.onKeyDown}
      >
        <defs>
          <pattern id="map-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="1.2" fill={theme.pattern} />
          </pattern>
          <pattern id="map-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke={theme.pattern} strokeWidth="1" />
          </pattern>
          {theme.root.glow && (
            <filter id="map-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
          )}
        </defs>
        <g ref={world}>
          {p.doc.style.backdrop !== "plain" && (
            <rect ref={backdrop} fill={`url(#map-${p.doc.style.backdrop === "grid" ? "grid" : "dots"})`} pointerEvents="none" />
          )}
          <Edges edges={p.layout.edges} />
          {theme.root.glow && <RootGlow box={p.layout.boxes.get(p.doc.root)!} fill={theme.root.fill} />}
          {p.layout.order.map((id) => {
            const b = p.layout.boxes.get(id)!;
            const n = p.doc.nodes[id];
            return (
              <NodeView
                key={id}
                box={b}
                sig={signature(b)}
                text={label(n)}
                level={b.depth + 1}
                expanded={n.children.length ? !n.collapsed : undefined}
                selected={selected.has(id)}
                hovered={hover === id}
                editing={p.editing === id}
                matched={p.matches.has(id)}
                current={p.current === id}
                proposal={!!n.ai}
                fileOver={fileOver === id}
                dimmed={!!drag && (drag.id === id || isInside(p.doc, id, drag.id))}
                foldable={n.children.length > 0 && !n.collapsed}
                ring={ring}
                onToggle={p.onToggle}
                onIcon={p.onIcon}
              />
            );
          })}
          {indicator}
          {dragging && drag && (
            <rect x={drag.x} y={drag.y} width={dragging.w} height={dragging.h} rx={cornerOf(dragging)} fill={dragging.look.fill ?? theme.background} stroke={ring} strokeWidth={2} opacity={0.75} pointerEvents="none" />
          )}
        </g>
      </svg>
      <div ref={overlay} className="pointer-events-none absolute left-0 top-0 origin-top-left">
        {editingBox && p.editing && (
          <EditBox
            key={p.editing}
            box={editingBox}
            value={p.doc.nodes[p.editing]?.text ?? ""}
            label={p.editLabel}
            placeholder={p.placeholder}
            onChange={(t) => p.onText(p.editing!, t)}
            onKeyDown={(e) => p.onEditKey(e, p.editing!)}
            onBlur={() => p.onEditBlur(p.editing!)}
          />
        )}
      </div>
    </div>
  );
});

/** What makes an idea look different: when it has not changed, it is not drawn again. */
const signature = (b: Box) =>
  `${b.x},${b.y},${b.w},${b.h},${b.lines.join("\n")},${b.look.fill},${b.look.stroke},${b.look.textColor},${b.look.shape},${b.look.fontFamily},${b.look.branch},${b.emoji?.char ?? ""},${b.image?.file ?? ""},${b.hidden},${b.icons.map((i) => i.kind).join("")},${b.empty}`;

const Edges = memo(function Edges({ edges }: { edges: Edge[] }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
      {edges.map((e) => (e.filled ? <path key={e.to} d={e.d} fill={e.color} stroke="none" /> : <path key={e.to} d={e.d} stroke={e.color} strokeWidth={e.width} />))}
    </g>
  );
});

const RootGlow = memo(function RootGlow({ box, fill }: { box: Box; fill: string }) {
  return <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={cornerOf(box)} fill={fill} opacity={0.45} filter="url(#map-glow)" pointerEvents="none" />;
});

interface NodeProps {
  box: Box;
  sig: string;
  text: string;
  level: number;
  expanded?: boolean;
  selected: boolean;
  hovered: boolean;
  editing: boolean;
  matched: boolean;
  current: boolean;
  proposal: boolean;
  fileOver: boolean;
  dimmed: boolean;
  foldable: boolean;
  ring: string;
  onToggle(id: string): void;
  onIcon(id: string, kind: "note" | "link" | "brain"): void;
}

const NodeView = memo(
  function NodeView(n: NodeProps) {
    const b = n.box;
    const look = b.look;
    const r = cornerOf(b);
    const pad = 4;
    return (
      <g
        data-node={b.id}
        id={`mapnode-${b.id}`}
        role="treeitem"
        aria-level={n.level}
        aria-selected={n.selected}
        aria-expanded={n.expanded}
        aria-label={n.text || undefined}
        opacity={n.dimmed ? 0.35 : 1}
        style={{ cursor: "pointer" }}
      >
        {(n.matched || n.current) && (
          <rect x={b.x - 7} y={b.y - 7} width={b.w + 14} height={b.h + 14} rx={r + 7} fill={n.current ? "#facc15" : "#fde047"} opacity={n.current ? 0.55 : 0.32} />
        )}
        {(n.selected || n.hovered || n.fileOver) && (
          <rect
            x={b.x - pad}
            y={b.y - pad}
            width={b.w + pad * 2}
            height={b.h + pad * 2}
            rx={r + pad}
            fill="none"
            stroke={n.ring}
            strokeWidth={n.selected || n.fileOver ? 2 : 1.25}
            strokeDasharray={n.fileOver ? "5 4" : undefined}
            opacity={n.selected || n.fileOver ? 1 : 0.45}
          />
        )}
        {/* A generous target: the whole box, even where nothing is drawn. */}
        <rect data-shape x={b.x} y={b.y} width={b.w} height={b.h} rx={r} fill="transparent" />
        {(look.shape === "card" || look.shape === "pill") && (
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={r} fill={look.fill ?? "none"} stroke={look.stroke ?? undefined} strokeWidth={look.stroke ? look.strokeWidth : undefined} />
        )}
        {look.shape === "underline" && look.underline && (
          <path d={`M${b.x},${b.y + b.h}H${b.x + b.w}`} stroke={look.underline} strokeWidth={b.depth <= 2 ? 2 : 1.6} strokeLinecap="round" fill="none" />
        )}
        {n.proposal && <rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} rx={r + 3} fill="none" stroke={look.branch} strokeWidth={1.4} strokeDasharray="4 4" />}
        {b.image && (
          <>
            <clipPath id={`clip-${b.id}`}>
              <rect x={b.x + b.image.x} y={b.y + b.image.y} width={b.image.w} height={b.image.h} rx={IMAGE_RADIUS} />
            </clipPath>
            <rect x={b.x + b.image.x} y={b.y + b.image.y} width={b.image.w} height={b.image.h} rx={IMAGE_RADIUS} fill={look.textColor} opacity={0.08} />
            <image
              href={imageUrl(b.image.file)}
              x={b.x + b.image.x}
              y={b.y + b.image.y}
              width={b.image.w}
              height={b.image.h}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#clip-${b.id})`}
            >
              {b.image.alt ? <title>{b.image.alt}</title> : null}
            </image>
          </>
        )}
        {b.emoji && (
          <text x={b.x + b.emoji.x} y={emojiBaseline(b)} fontSize={b.emoji.size} fontFamily={EMOJI_FONT} aria-hidden>
            {b.emoji.char}
          </text>
        )}
        <text
          fontFamily={look.fontFamily}
          fontSize={look.fontSize}
          fontWeight={look.fontWeight}
          fill={look.textColor}
          opacity={n.editing ? 0 : b.empty ? 0.38 : 1}
          xmlSpace="preserve"
          aria-hidden
        >
          {b.lines.map((line, i) => (
            <tspan key={i} x={b.x + b.text.x} y={baseline(b, i)}>
              {line}
            </tspan>
          ))}
        </text>
        {!n.editing &&
          b.icons.map((icon) => (
            <g
              key={icon.kind}
              data-action="icon"
              transform={`translate(${b.x + icon.x} ${b.y + icon.y})`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                n.onIcon(b.id, icon.kind);
              }}
              style={{ cursor: "pointer" }}
            >
              <rect x={-3} y={-3} width={icon.size + 6} height={icon.size + 6} fill="transparent" />
              <path d={ICON_PATHS[icon.kind]} fill="none" stroke={iconColor(b)} strokeOpacity={0.75} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        {b.badge && (
          <g
            data-action="toggle"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              n.onToggle(b.id);
            }}
            style={{ cursor: "pointer" }}
          >
            <circle cx={b.badge.x} cy={b.badge.y} r={BADGE_RADIUS + 4} fill="transparent" />
            <circle cx={b.badge.x} cy={b.badge.y} r={BADGE_RADIUS} fill={look.branch} />
            <text x={b.badge.x} y={b.badge.y + 3.5} textAnchor="middle" fontFamily={look.fontFamily} fontSize={10} fontWeight={700} fill={badgeInk(look.branch)}>
              {badgeText(b.hidden)}
            </text>
          </g>
        )}
        {n.foldable && (n.hovered || n.selected) && !n.editing && b.id && (
          <FoldButton box={b} onToggle={n.onToggle} />
        )}
      </g>
    );
  },
  (a, b) =>
    a.sig === b.sig &&
    a.text === b.text &&
    a.selected === b.selected &&
    a.hovered === b.hovered &&
    a.editing === b.editing &&
    a.matched === b.matched &&
    a.current === b.current &&
    a.proposal === b.proposal &&
    a.fileOver === b.fileOver &&
    a.dimmed === b.dimmed &&
    a.foldable === b.foldable &&
    a.expanded === b.expanded &&
    a.ring === b.ring &&
    a.onToggle === b.onToggle &&
    a.onIcon === b.onIcon
);

/** A small "−" where the branch leaves, to fold what hangs from the idea. */
function FoldButton({ box: b, onToggle }: { box: Box; onToggle(id: string): void }) {
  const x = b.dir === "left" ? b.x - 12 : b.dir === "down" ? b.x + b.w / 2 : b.x + b.w + 12;
  const y = b.dir === "down" ? b.y + b.h + 12 : b.out.y;
  return (
    <g
      data-action="fold"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(b.id);
      }}
      style={{ cursor: "pointer" }}
    >
      <circle cx={x} cy={y} r={11} fill="transparent" />
      <circle cx={x} cy={y} r={7.5} fill={b.look.branch} />
      <path d={`M${x - 3.5},${y}H${x + 3.5}`} stroke={badgeInk(b.look.branch)} strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

/** Where a dragged idea would land: a ring around its new parent, or a line where it would slot in. */
function indicatorFor(t: DropTarget, layout: Layout, doc: MapDoc) {
  const ring = layout.theme.dark ? "#60a5fa" : "#2563eb";
  const b = layout.boxes.get(t.ref);
  if (!b) return null;
  if (t.mode === "child" || t.mode === "side") {
    if (t.mode === "side") {
      const x = t.side === "left" ? b.x - 40 : b.x + b.w + 40;
      return <path d={`M${x},${b.y - 30}V${b.y + b.h + 30}`} stroke={ring} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 6" pointerEvents="none" />;
    }
    return <rect x={b.x - 6} y={b.y - 6} width={b.w + 12} height={b.h + 12} rx={cornerOf(b) + 6} fill={ring} fillOpacity={0.12} stroke={ring} strokeWidth={2} pointerEvents="none" />;
  }
  const vertical = doc.style.layout === "down";
  if (vertical) {
    const x = t.mode === "before" ? b.x - 8 : b.x + b.w + 8;
    return <path d={`M${x},${b.y - 4}V${b.y + b.h + 4}`} stroke={ring} strokeWidth={3} strokeLinecap="round" pointerEvents="none" />;
  }
  const y = t.mode === "before" ? b.y - 6 : b.y + b.h + 6;
  return <path d={`M${b.x - 4},${y}H${b.x + b.w + 4}`} stroke={ring} strokeWidth={3} strokeLinecap="round" pointerEvents="none" />;
}

/** Typing in an idea: a field over its text, in its font, growing as it fills. */
function EditBox({
  box,
  value,
  label: aria,
  placeholder,
  onChange,
  onKeyDown,
  onBlur,
}: {
  box: Box;
  value: string;
  label: string;
  placeholder: string;
  onChange(v: string): void;
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  onBlur(): void;
}) {
  const el = useRef<HTMLTextAreaElement>(null);
  const look = box.look;
  // Phones zoom into a field set under 16 px: the field is set at 16 px at
  // least and scaled down to the idea's size, so it looks the same and the
  // page never jumps.
  const size = Math.max(16, look.fontSize);
  const k = look.fontSize / size;
  // As wide as the layout lets the text be, so it wraps where the map will.
  const iconsW = box.icons.length ? box.icons.length * 14 + (box.icons.length - 1) * 5 + 7 : 0;
  const width = Math.max(60, look.maxTextWidth - (box.emoji ? box.emoji.size + 6 : 0) - iconsW) + 2;
  // A double tap ends on the field that just appeared under the finger: the
  // browser's compatibility clicks would select a word in it. It takes taps a moment later.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = el.current;
    if (!t) return;
    t.focus({ preventScroll: true });
    const end = t.value.length;
    t.setSelectionRange(end, end);
    const timer = setTimeout(() => setArmed(true), 450);
    return () => clearTimeout(timer);
  }, []);
  useLayoutEffect(() => {
    const t = el.current;
    if (!t) return;
    // Over the stylesheet's own 16 px rule for fields on phones (it is !important).
    t.style.setProperty("font-size", `${size}px`, "important");
    t.style.height = "0px";
    t.style.height = `${Math.max(look.lineHeight / k, t.scrollHeight)}px`;
  });
  return (
    <textarea
      ref={el}
      aria-label={aria}
      value={value}
      placeholder={placeholder}
      spellCheck
      rows={1}
      maxLength={1000}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      data-map-edit=""
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:opacity-40 focus-visible:outline-none",
        armed ? "pointer-events-auto" : "pointer-events-none"
      )}
      style={{
        left: box.x + box.text.x,
        top: box.y + box.text.y,
        width: width / k,
        transform: k === 1 ? undefined : `scale(${k})`,
        transformOrigin: "0 0",
        fontFamily: look.fontFamily,
        fontWeight: look.fontWeight,
        fontSize: size,
        lineHeight: `${look.lineHeight / k}px`,
        color: look.textColor,
        caretColor: look.textColor,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    />
  );
}
