"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The fields of the sales forms: a label always visible, a hint below when
 * there is one, the error in its place. 16 px text on a phone so iOS does
 * not zoom into the field.
 */

export const inputCls =
  "h-10 w-full rounded-md border border-border bg-surface-2/40 px-3 text-base outline-none transition-colors focus:border-border-strong aria-[invalid=true]:border-danger/60 sm:h-9 sm:text-[0.875rem]";

export function Field({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const id = useId();
  const note = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-[0.8125rem] text-muted-foreground">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": note })}
      {error ? (
        <p id={note} className="text-[0.75rem] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={note} className="text-[0.72rem] leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A text area: the same look, its height left to its `rows`. (`inputCls` fixes
 * the height at every width, and `h-auto` alone does not undo `sm:h-9`.)
 */
export const areaCls =
  "w-full rounded-md border border-border bg-surface-2/40 px-3 py-2 text-base outline-none transition-colors focus:border-border-strong aria-[invalid=true]:border-danger/60 sm:text-[0.875rem]";

/** Cents shown as euros in a field ("1250,5" stays as typed). */
export const eurosOf = (cents: number | undefined, locale: "fr" | "en") =>
  cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", locale === "fr" ? "," : ".");
