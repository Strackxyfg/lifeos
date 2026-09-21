import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as compact currency (e.g. $1.2k). */
/**
 * Money, formatted for the reader's locale.
 *
 * Previously pinned to "en-US", so a French user read "$1,234" everywhere —
 * the wrong symbol position, the wrong grouping and the wrong decimal mark.
 */
export function formatCurrency(n: number, locale: string = "en", currency = "USD") {
  const tag = locale === "fr" ? "fr-FR" : "en-US";
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency,
    notation: n >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: n >= 10_000 ? 1 : 0,
  }).format(n);
}

/** Deterministic pseudo-delay helper for demos/simulations. */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
