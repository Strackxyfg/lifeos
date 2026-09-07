import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as compact currency (e.g. $1.2k). */
export function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
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
