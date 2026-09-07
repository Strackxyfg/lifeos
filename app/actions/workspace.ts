"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStore, getUserKey } from "@/lib/db/store";

export type ActionResult = { ok: true } | { ok: false; error: string };

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

/* ── Projects ─────────────────────────────────────────────────────── */

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  status: z.enum(["Planning", "In progress", "Blocked", "Done"]).default("Planning"),
  priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
  owner: z.string().trim().max(60).default(""),
  due: z.string().trim().max(40).default(""),
  progress: z.coerce.number().int().min(0).max(100).default(0),
});

export async function createProject(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid project.");

  try {
    const userKey = await getUserKey();
    await getStore().insert(userKey, "projects", parsed.data);
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save.");
  }
}

export async function updateProjectStatus(id: string, status: string): Promise<ActionResult> {
  const valid = ["Planning", "In progress", "Blocked", "Done"];
  if (!valid.includes(status)) return fail("Unknown status.");
  try {
    const userKey = await getUserKey();
    await getStore().update(userKey, "projects", id, {
      status: status as (typeof valid)[number] as never,
      ...(status === "Done" ? { progress: 100 } : {}),
    });
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not update.");
  }
}

export async function deleteProject(id: string): Promise<ActionResult> {
  try {
    await getStore().remove(await getUserKey(), "projects", id);
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not delete.");
  }
}

/* ── Deals ────────────────────────────────────────────────────────── */

const dealSchema = z.object({
  company: z.string().trim().min(1, "Company is required.").max(120),
  name: z.string().trim().max(120).default(""),
  stage: z.enum(["Lead", "Qualified", "Proposal", "Won", "Lost"]).default("Lead"),
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  owner: z.string().trim().max(60).default(""),
  next: z.string().trim().max(120).default(""),
});

export async function createDeal(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = dealSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid deal.");

  try {
    const d = parsed.data;
    await getStore().insert(await getUserKey(), "deals", {
      ...d,
      name: d.name || d.company,
    });
    revalidatePath("/crm");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save.");
  }
}

/* ── Transactions ─────────────────────────────────────────────────── */

const txnSchema = z.object({
  item: z.string().trim().min(1, "Description is required.").max(120),
  type: z.enum(["Income", "Expense"]).default("Expense"),
  amount: z.coerce.number().min(0).max(1_000_000_000),
  category: z.string().trim().max(60).default("Other"),
  date: z.string().trim().max(40).default(""),
});

export async function createTransaction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const parsed = txnSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid entry.");

  try {
    const t = parsed.data;
    await getStore().insert(await getUserKey(), "transactions", {
      ...t,
      date: t.date || new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
    });
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save.");
  }
}

/* ── Tasks ────────────────────────────────────────────────────────── */

export async function setTaskDone(id: string, done: boolean): Promise<ActionResult> {
  try {
    await getStore().update(await getUserKey(), "tasks", id, { done });
    revalidatePath("/dashboard");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not update.");
  }
}

/* ── Second Brain ─────────────────────────────────────────────────── */

const brainSchema = z.object({
  title: z.string().trim().min(1).max(500),
  category: z.enum(["ideas", "thoughts", "next", "knowledge", "insights"]),
  kind: z.enum(["idea", "thought", "task", "note", "insight"]),
  detail: z.string().trim().max(500).optional(),
  ai: z.boolean().default(false),
});

export async function createBrainItem(input: unknown): Promise<ActionResult> {
  const parsed = brainSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid note.");

  try {
    await getStore().insert(await getUserKey(), "brain", {
      ...parsed.data,
      detail: parsed.data.detail ?? null,
      seedKey: null,
      done: false,
    });
    revalidatePath("/brain");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save.");
  }
}

export async function setBrainItemDone(id: string, done: boolean): Promise<ActionResult> {
  try {
    await getStore().update(await getUserKey(), "brain", id, { done });
    revalidatePath("/brain");
    return ok;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not update.");
  }
}
