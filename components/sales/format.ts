import type { Locale } from "@/lib/i18n/config";
import { formatCents } from "@/lib/sales/compute";
import type { Problem, Status, Warning } from "@/lib/sales/legal";
import type { SalesCode, SalesResult } from "@/app/actions/sales";
import type { SalesMessages } from "@/lib/i18n/sales";

/** Shared by the sales screens: money, days, the tone of a status, an action's failure in words. */

export const money = (cents: number, locale: Locale) => formatCents(cents, locale);

export function day(iso: string | undefined | null, locale: Locale): string {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Here rather than beside the tabs: a server page cannot read a value from a client module.
export type SalesTab = "documents" | "clients" | "catalog" | "business";
export const SALES_TABS: SalesTab[] = ["documents", "clients", "catalog", "business"];

export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const TONE: Record<Status, string> = {
  draft: "border-border text-muted-foreground",
  sent: "border-accent/40 text-accent",
  accepted: "border-success/40 text-success",
  declined: "border-border text-muted",
  expired: "border-warning/40 text-warning",
  invoiced: "border-success/40 text-success",
  issued: "border-accent/40 text-accent",
  partial: "border-warning/40 text-warning",
  paid: "border-success/40 text-success",
  overdue: "border-danger/50 text-danger",
  cancelled: "border-border text-muted line-through",
};

export type Failure = { ok: false; code: SalesCode | "network"; field?: string; problems?: Problem[]; warnings?: Warning[] };

/** What a failed action says, in the person's language. */
export function failureText(t: SalesMessages, r: Failure): string {
  const field = r.field?.split(".").pop();
  if (r.code === "invalid" && field && field in t.fieldErrors) return t.fieldErrors[field as keyof SalesMessages["fieldErrors"]];
  return t.errors[r.code];
}

/** Runs an action, turning a thrown network error into a result. */
export async function attempt<T>(run: () => Promise<SalesResult<T>>): Promise<{ ok: true; data: T } | Failure> {
  try {
    return await run();
  } catch {
    return { ok: false, code: "network" };
  }
}
