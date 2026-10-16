"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** The pieces the map editor's toolbars and panels are made of. */

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; tone?: "default" | "danger" }
>(function IconButton({ label, active, tone = "default", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
        "disabled:pointer-events-none disabled:opacity-35",
        active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        tone === "danger" && "hover:text-red-500",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** A floating bar over the map: the app's surface, a little glass. */
export function Floating({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("pointer-events-auto rounded-xl border border-border bg-surface/95 shadow-lift backdrop-blur-md supports-[backdrop-filter]:bg-surface/80", className)} {...rest}>
      {children}
    </div>
  );
}

/** A list of actions that opens from a button; Escape or a click elsewhere closes it. */
export function Menu({
  label,
  icon,
  items,
  align = "end",
  className,
}: {
  label: string;
  icon: React.ReactNode;
  items: ({ id: string; label: string; icon?: React.ReactNode; onSelect: () => void; tone?: "danger"; disabled?: boolean } | "separator")[];
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    // The first item takes the focus, as in any menu.
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus());
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const list = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <IconButton ref={button} label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} active={open}>
        {icon}
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease }}
            className={cn(
              "absolute top-full z-[90] mt-1.5 min-w-[13rem] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-lift",
              align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left"
            )}
          >
            {items.map((it, i) =>
              it === "separator" ? (
                <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-border" />
              ) : (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] outline-none transition-colors",
                    "hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-40 [@media(pointer:coarse)]:py-2.5",
                    it.tone === "danger" ? "text-red-500" : "text-foreground"
                  )}
                >
                  {it.icon && <span className="grid h-4 w-4 place-items-center text-muted-foreground">{it.icon}</span>}
                  {it.label}
                </button>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A panel beside the map that leaves it in view and usable: on the right on
 * a large screen, from the bottom on a phone.
 */
export function SidePanel({ open, title, onClose, closeLabel, children }: { open: boolean; title: string; onClose: () => void; closeLabel: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          aria-label={title}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: 0.2, ease }}
          className={cn(
            "pointer-events-auto absolute inset-x-0 bottom-0 z-[60] flex max-h-[min(64%,34rem)] flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-lift",
            "sm:inset-x-auto sm:bottom-3 sm:right-3 sm:top-3 sm:max-h-none sm:w-[20.5rem] sm:rounded-2xl"
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border py-2 pl-4 pr-2">
            <h2 className="text-[0.875rem] font-medium tracking-tight">{title}</h2>
            <IconButton label={closeLabel} onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{children}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

export function Section({ title, children, action, id }: { title: string; children: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A row of choices, one selected: radio buttons that look like a segmented control. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-border bg-background/60 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = options.findIndex((x) => x.value === value);
              const next = options[(i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
              onChange(next.value);
              (e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
            }}
            data-value={o.value}
            tabIndex={on ? 0 : -1}
            className={cn(
              "flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.75rem] transition-colors [@media(pointer:coarse)]:min-h-10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
              on ? "bg-surface-2 font-medium text-foreground shadow-subtle" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
