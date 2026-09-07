"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import type { Alert } from "@/lib/data/alerts";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

const dot: Record<Alert["level"], string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-muted-foreground",
};

/** Bell + dropdown panel of real, data-derived alerts. */
export function Notifications({ alerts }: { alerts: Alert[] }) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const urgent = alerts.filter((a) => a.level === "danger").length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={m.notifications.title}
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {alerts.length > 0 && (
          <span
            className={cn(
              "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
              urgent > 0 ? "bg-danger" : "bg-accent"
            )}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease }}
            className="glass absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border-strong shadow-lift"
          >
            <div className="border-b border-border px-4 py-2.5 text-[0.8125rem] font-medium">
              {m.notifications.title}
            </div>
            {alerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {m.notifications.empty}
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {alerts.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={a.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 border-b border-border px-4 py-3 text-[0.8125rem] transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot[a.level])} />
                      <span className="text-foreground/85">{a.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
