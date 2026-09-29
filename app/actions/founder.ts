"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import type { DbReminder, ReviewDecision } from "@/lib/db/types";
import { isValidZone, zonedInstant } from "@/lib/reminders/zoned";
import { isoDate } from "@/lib/finance/dates";

/**
 * What founders run their week on: dated money, the cash they state, the
 * next action of each deal (with its reminder), and the Friday review.
 *
 * Every write needs a signed-in person (never the shared demo identity) and
 * migration 013; it is validated here whatever the page sent, and failures
 * come back as codes the page translates.
 */

export type FounderErrorCode = "invalid" | "unauthorized" | "not_found" | "migration_pending" | "failed";
export type FounderResult<T> = { ok: true; data: T } | { ok: false; code: FounderErrorCode };

const fail = (code: FounderErrorCode): FounderResult<never> => ({ ok: false, code });
const idSchema = z.string().trim().min(1).max(64);
/** A calendar day that exists. */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => isoDate(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))) === s);

async function ready(): Promise<{ userKey: string } | FounderResult<never>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  if (!(await getStore().supportsFounder())) return fail("migration_pending");
  return { userKey };
}

function failure(err: unknown): FounderResult<never> {
  if (isMissingTable(err)) return fail("migration_pending");
  console.error("[founder]", err);
  return fail("failed");
}

/* ── Dated transactions ──────────────────────────────────────────── */

const datesSchema = z.array(z.object({ id: idSchema, date: daySchema.nullable() })).min(1).max(500);

/**
 * Gives transactions their real day (or takes it back). The dates are the
 * person's: proposed by the page, confirmed by them, checked here.
 */
export async function setTransactionDates(input: unknown): Promise<FounderResult<{ updated: number }>> {
  const parsed = datesSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    let updated = 0;
    for (const { id, date } of parsed.data) {
      const t = await store.get(gate.userKey, "transactions", id);
      if (!t) continue;
      await store.update(gate.userKey, "transactions", id, { occurredOn: date });
      updated++;
    }
    revalidatePath("/finance");
    revalidatePath("/reports/investor");
    return { ok: true, data: { updated } };
  } catch (err) {
    return failure(err);
  }
}

/* ── Cash balances ───────────────────────────────────────────────── */

const balanceSchema = z.object({
  amount: z.coerce.number().min(-1e12).max(1e12),
  asOf: daySchema,
  note: z.string().trim().max(300).optional().default(""),
});

/** States the cash on a day. One per day: stating it again corrects it. */
export async function saveBalance(input: unknown): Promise<FounderResult<{ id: string }>> {
  const parsed = balanceSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    const { amount, asOf, note } = parsed.data;
    const rounded = Math.round(amount * 100) / 100;
    const existing = (await store.list(gate.userKey, "balances")).find((b) => b.asOf === asOf);
    let id: string;
    if (existing) {
      await store.update(gate.userKey, "balances", existing.id, { amount: rounded, note: note || null });
      id = existing.id;
    } else {
      id = (await store.insert(gate.userKey, "balances", { amount: rounded, asOf, note: note || null })).id;
    }
    revalidatePath("/finance");
    revalidatePath("/reports/investor");
    return { ok: true, data: { id } };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteBalance(id: unknown): Promise<FounderResult<{ id: string }>> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    if (!(await store.get(gate.userKey, "balances", pid.data))) return fail("not_found");
    await store.remove(gate.userKey, "balances", pid.data);
    revalidatePath("/finance");
    return { ok: true, data: { id: pid.data } };
  } catch (err) {
    return failure(err);
  }
}

/* ── A deal's next action, and its reminder ──────────────────────── */

const moment = z
  .string()
  .datetime({ offset: true })
  .refine((s) => {
    const t = Date.parse(s);
    return t > Date.now() - 366 * 86_400_000 && t < Date.now() + 5 * 366 * 86_400_000;
  });

const nextSchema = z.object({
  id: idSchema,
  next: z.string().trim().max(120),
  nextAt: moment.nullable(),
  remind: z.boolean(),
  zone: z.string().refine(isValidZone),
});

/**
 * Plans a deal's next action: what, when — and, if asked, a reminder at
 * that moment, titled after the deal. The reminder follows the plan: moved
 * when the moment moves, removed when the reminder is no longer wanted.
 * Only an open reminder is touched; one already done stays as history.
 */
export async function planDealNext(input: unknown): Promise<FounderResult<{ reminderId: string | null }>> {
  const parsed = nextSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    const { id, next, nextAt, remind, zone } = parsed.data;
    const deal = await store.get(gate.userKey, "deals", id);
    if (!deal) return fail("not_found");
    const at = nextAt ? new Date(nextAt).toISOString() : null;
    await store.update(gate.userKey, "deals", id, { next, nextAt: at });

    const open = (await store.list(gate.userKey, "reminders")).filter((r) => r.dealId === id && !r.done);
    const title = next ? `${deal.name}: ${next}` : deal.name;
    let reminderId: string | null = null;
    if (remind && at) {
      const [keep, ...extra] = open;
      if (keep) {
        const patch: Partial<DbReminder> = { title, dueAt: at, anchorAt: at, repeat: "none", zone, notifiedAt: null, done: false, doneAt: null };
        await store.update(gate.userKey, "reminders", keep.id, patch);
        reminderId = keep.id;
      } else {
        reminderId = (
          await store.insert(gate.userKey, "reminders", {
            title,
            dueAt: at,
            anchorAt: at,
            repeat: "none",
            zone,
            done: false,
            doneAt: null,
            noteId: null,
            notifiedAt: null,
            dealId: id,
          })
        ).id;
      }
      for (const r of extra) await store.remove(gate.userKey, "reminders", r.id);
    } else {
      for (const r of open) await store.remove(gate.userKey, "reminders", r.id);
    }
    revalidatePath("/crm");
    revalidatePath("/dashboard");
    revalidatePath("/hub");
    return { ok: true, data: { reminderId } };
  } catch (err) {
    return failure(err);
  }
}

/* ── The Friday review ───────────────────────────────────────────── */

const decisionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(300),
  why: z.string().trim().max(600).default(""),
  revisitOn: daySchema.nullable(),
  reminderId: z.string().max(64).nullable().optional(),
});

const reviewSchema = z.object({
  weekStart: daySchema.refine((s) => new Date(`${s}T12:00:00Z`).getUTCDay() === 1, "a Monday"),
  wins: z.string().max(4000).default(""),
  blockers: z.string().max(4000).default(""),
  lessons: z.string().max(4000).default(""),
  focus: z.string().max(1000).default(""),
  decisions: z.array(decisionSchema).max(20).default([]),
  zone: z.string().refine(isValidZone),
});

/**
 * Saves the week's review. A decision with a day to revisit it gets a
 * reminder that morning (9:00, the person's time), once — the reminder's id
 * is kept with the decision, and moved if the day changes.
 */
export async function saveReview(input: unknown): Promise<FounderResult<{ id: string; decisions: ReviewDecision[] }>> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    const { weekStart, wins, blockers, lessons, focus, zone } = parsed.data;
    const remindersOk = await store.supportsReminders();
    const reminders = remindersOk ? await store.list(gate.userKey, "reminders") : [];
    const existing = (await store.list(gate.userKey, "reviews")).find((r) => r.weekStart === weekStart);
    // Decisions dropped from the review take their pending reminders with them.
    const kept = new Set(parsed.data.decisions.map((d) => d.id));
    for (const d of existing?.decisions ?? []) {
      if (!kept.has(d.id) && d.reminderId) {
        const r = reminders.find((x) => x.id === d.reminderId);
        if (r && !r.done) await store.remove(gate.userKey, "reminders", r.id);
      }
    }
    const decisions: ReviewDecision[] = [];
    for (const d of parsed.data.decisions) {
      let reminderId = d.reminderId ?? null;
      const current = reminderId ? reminders.find((r) => r.id === reminderId) : undefined;
      if (remindersOk && d.revisitOn) {
        const [y, mo, day] = d.revisitOn.split("-").map(Number);
        const due = zonedInstant({ y, mo, d: day, h: 9, mi: 0 }, zone).toISOString();
        const title = `↻ ${d.text}`.slice(0, 300);
        if (current && !current.done) {
          await store.update(gate.userKey, "reminders", current.id, { title, dueAt: due, anchorAt: due, zone, notifiedAt: null });
        } else if (!current) {
          reminderId = (
            await store.insert(gate.userKey, "reminders", {
              title,
              dueAt: due,
              anchorAt: due,
              repeat: "none",
              zone,
              done: false,
              doneAt: null,
              noteId: null,
              notifiedAt: null,
            })
          ).id;
        }
      } else if (current && !current.done) {
        await store.remove(gate.userKey, "reminders", current.id);
        reminderId = null;
      }
      decisions.push({ id: d.id, text: d.text, why: d.why, revisitOn: d.revisitOn, reminderId });
    }
    const fields = { wins, blockers, lessons, focus, decisions, updatedAt: new Date().toISOString() };
    let id: string;
    if (existing) {
      await store.update(gate.userKey, "reviews", existing.id, fields);
      id = existing.id;
    } else {
      id = (await store.insert(gate.userKey, "reviews", { weekStart, ...fields })).id;
    }
    revalidatePath("/review");
    revalidatePath("/dashboard");
    return { ok: true, data: { id, decisions } };
  } catch (err) {
    return failure(err);
  }
}
