"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import type { ActionResult } from "@/app/actions/workspace";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

export interface QuickAddField {
  name: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  /** Full width in the 2-col grid. */
  wide?: boolean;
}

const initial: ActionResult = { ok: true };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonVariants({ size: "md" }), "w-full")}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  );
}

/**
 * Modal form that posts to a server action, then refreshes so the new row
 * appears from the database rather than from optimistic local state.
 */
export function QuickAdd({
  triggerLabel,
  title,
  submitLabel,
  fields,
  action,
  successMessage,
}: {
  triggerLabel: string;
  title: string;
  submitLabel: string;
  fields: QuickAddField[];
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  successMessage: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef(state);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.ok) {
      setOpen(false);
      formRef.current?.reset();
      toast(successMessage);
      router.refresh();
    }
  }, [state, successMessage, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonVariants({ size: "sm" })}>
        <Plus className="h-4 w-4" /> {triggerLabel}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="glass relative w-full max-w-md overflow-hidden rounded-xl border border-border-strong shadow-lift"
              initial={{ opacity: 0, scale: 0.98, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -6 }}
              transition={{ duration: 0.18, ease }}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-medium tracking-tight">{title}</h3>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form ref={formRef} action={formAction} className="grid grid-cols-2 gap-3 p-4">
                {fields.map((f) => (
                  <label key={f.name} className={cn("block", (f.wide || f.type === "select") && "col-span-2", f.wide && "col-span-2")}>
                    <span className="mb-1.5 block text-[0.75rem] text-muted-foreground">{f.label}</span>
                    {f.type === "select" ? (
                      <select
                        name={f.name}
                        defaultValue={f.defaultValue}
                        className="h-10 w-full rounded-lg border border-border bg-surface-2/60 px-2.5 text-sm outline-none focus:border-border-strong"
                      >
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        name={f.name}
                        type={f.type ?? "text"}
                        required={f.required}
                        placeholder={f.placeholder}
                        defaultValue={f.defaultValue}
                        step={f.type === "number" ? "any" : undefined}
                        className="h-10 w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none placeholder:text-muted focus:border-border-strong"
                      />
                    )}
                  </label>
                ))}

                {!state.ok && (
                  <p className="col-span-2 text-[0.8125rem] text-danger">{state.error}</p>
                )}
                <div className="col-span-2 mt-1">
                  <Submit label={submitLabel} />
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
