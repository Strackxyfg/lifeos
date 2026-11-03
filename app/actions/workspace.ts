"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStore, SignedOut, writerKey } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/config";
import type { Feature } from "@/lib/plans/editions";
import { locked } from "@/lib/plans/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

/** A caught error as the person reads it: signed out in their language, anything else as it was. */
async function failure(e: unknown, fallback: string): Promise<ActionResult> {
  if (e instanceof SignedOut) return fail((await getMessages()).settings.errors.unauthorized);
  return fail(e instanceof Error ? e.message : fallback);
}

type FormWords = Awaited<ReturnType<typeof getMessages>>["form"];

/** The first problem of a form, in the person's language, naming the field as the form labels it. */
async function invalidForm(error: z.ZodError, labels: Record<string, keyof FormWords>): Promise<ActionResult> {
  const words = (await getMessages()).form;
  const issue = error.issues[0];
  const key = labels[String(issue?.path[0] ?? "")];
  const field = key ? words[key] : "";
  const empty = issue?.code === "too_small" && issue.origin === "string" && issue.minimum === 1;
  return fail(fill(empty ? words.required : words.invalid, { field }));
}

/** The refusal, in the person's language, when their edition does not open the feature. */
async function outside(feature: Feature): Promise<ActionResult | null> {
  const needed = await locked(feature);
  if (!needed) return null;
  const t = (await getMessages()).editions;
  return fail(fill(t.lockedTitle, { feature: t.features[feature], edition: t.names[needed] }));
}

/* ── Projects ─────────────────────────────────────────────────────── */

const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(["Planning", "In progress", "Blocked", "Done"]).default("Planning"),
  priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
  owner: z.string().trim().max(60).default(""),
  due: z.string().trim().max(40).default(""),
  progress: z.coerce.number().int().min(0).max(100).default(0),
});

export async function createProject(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const refused = await outside("projects");
  if (refused) return refused;
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidForm(parsed.error, { name: "name", status: "status", priority: "priority", owner: "owner", due: "due", progress: "progress" });

  try {
    const userKey = await writerKey();
    await getStore().insert(userKey, "projects", parsed.data);
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return failure(e, "Could not save.");
  }
}

export async function updateProjectStatus(id: string, status: string): Promise<ActionResult> {
  const refused = await outside("projects");
  if (refused) return refused;
  const valid = ["Planning", "In progress", "Blocked", "Done"];
  if (!valid.includes(status)) return fail("Unknown status.");
  try {
    const userKey = await writerKey();
    await getStore().update(userKey, "projects", id, {
      status: status as (typeof valid)[number] as never,
      ...(status === "Done" ? { progress: 100 } : {}),
    });
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return failure(e, "Could not update.");
  }
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const refused = await outside("projects");
  if (refused) return refused;
  try {
    await getStore().remove(await writerKey(), "projects", id);
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return failure(e, "Could not delete.");
  }
}

/* ── Deals ────────────────────────────────────────────────────────── */

const dealSchema = z.object({
  company: z.string().trim().min(1).max(120),
  name: z.string().trim().max(120).default(""),
  stage: z.enum(["Lead", "Qualified", "Proposal", "Won", "Lost"]).default("Lead"),
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  owner: z.string().trim().max(60).default(""),
  next: z.string().trim().max(120).default(""),
});

export async function createDeal(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const refused = await outside("crm");
  if (refused) return refused;
  const parsed = dealSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidForm(parsed.error, { company: "company", name: "dealName", stage: "stage", value: "value", owner: "owner", next: "nextStep" });

  try {
    const d = parsed.data;
    await getStore().insert(await writerKey(), "deals", {
      ...d,
      name: d.name || d.company,
    });
    revalidatePath("/crm");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return failure(e, "Could not save.");
  }
}

/* ── Transactions ─────────────────────────────────────────────────── */

const txnSchema = z.object({
  item: z.string().trim().min(1).max(120),
  type: z.enum(["Income", "Expense"]).default("Expense"),
  amount: z.coerce.number().min(0).max(1_000_000_000),
  category: z.string().trim().max(60).default("Other"),
  date: z.string().trim().max(40).default(""),
});

export async function createTransaction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const refused = await outside("finance");
  if (refused) return refused;
  const parsed = txnSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidForm(parsed.error, { item: "description", type: "type", amount: "amount", category: "category", date: "date" });

  try {
    const t = parsed.data;
    const store = getStore();
    // A date picked in the form is a real day: kept as one (migration 013)
    // for the treasury, and as text for the list.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
    const dated = day !== null && (await store.supportsFounder());
    await store.insert(await writerKey(), "transactions", {
      ...t,
      date: t.date || new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
      ...(dated ? { occurredOn: day } : {}),
    });
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return failure(e, "Could not save.");
  }
}

/* ── Tasks ────────────────────────────────────────────────────────── */

export async function setTaskDone(id: string, done: boolean): Promise<ActionResult> {
  try {
    await getStore().update(await writerKey(), "tasks", id, { done });
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return failure(e, "Could not update.");
  }
}
