"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

type ToastVariant = "success" | "error";
type ToastItem = { id: number; message: string; variant: ToastVariant };

/** Fire a toast from anywhere: toast("Saved") / toast("Failed", "error"). */
export function toast(message: string, variant: ToastVariant = "success") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("lifeos:toast", { detail: { message, variant } }));
  }
}

/** Mount once (in the app layout). Renders a bottom-right stack. */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; variant: ToastVariant }>).detail;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message: detail.message, variant: detail.variant ?? "success" }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
    };
    window.addEventListener("lifeos:toast", onToast);
    return () => window.removeEventListener("lifeos:toast", onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[110] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.22, ease }}
            className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-sm shadow-lift"
          >
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full",
                t.variant === "error" ? "bg-danger/15 text-danger" : "bg-success/15 text-success"
              )}
            >
              {t.variant === "error" ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            </span>
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
