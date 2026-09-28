"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import type { DbReminder } from "@/lib/db/types";
import { REPEATS, completion, snoozeUntil, type SnoozeChoice } from "@/lib/reminders/schedule";
import { isValidZone } from "@/lib/reminders/zoned";
import { toClientReminder, type ClientReminder } from "@/lib/reminders/client";

/**
 * Reminders, as actions. Every write needs a signed-in person (never the
 * shared demo identity), is validated here whatever the page sent, and
 * reports failures as codes the page translates.
 */

export type ReminderErrorCode = "invalid" | "unauthorized" | "not_found" | "migration_pending" | "failed";
export type ReminderResult<T> = { ok: true; data: T } | { ok: false; code: ReminderErrorCode };

const fail = (code: ReminderErrorCode): ReminderResult<never> => ({ ok: false, code });

const idSchema = z.string().trim().min(1).max(64);
/** A moment within reach: not a decade gone, not a century ahead. */
const momentSchema = z
  .string()
  .datetime({ offset: true })
  .refine((s) => {
    const t = Date.parse(s);
    const now = Date.now();
    return t > now - 366 * 86_400_000 && t < now + 10 * 366 * 86_400_000;
  });

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  dueAt: momentSchema,
  repeat: z.enum(REPEATS),
  zone: z.string().refine(isValidZone),
  noteId: z.string().trim().min(1).max(64).nullable().optional(),
});

function refresh() {
  revalidatePath("/dashboard");
  revalidatePath("/hub");
}

/** Signed in, and the table exists. */
async function ready(): Promise<{ userKey: string } | ReminderResult<never>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  if (!(await getStore().supportsReminders())) return fail("migration_pending");
  return { userKey };
}

async function own(userKey: string, id: unknown): Promise<DbReminder | null> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return null;
  return getStore().get(userKey, "reminders", pid.data);
}

function failure(err: unknown): ReminderResult<never> {
  if (isMissingTable(err)) return fail("migration_pending");
  console.error("[reminders]", err);
  return fail("failed");
}

export async function createReminder(input: unknown): Promise<ReminderResult<ClientReminder>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    const { title, dueAt, repeat, zone, noteId } = parsed.data;
    // A reminder about a note only if the note is the person's.
    const note = noteId ? await store.get(gate.userKey, "brain", noteId) : null;
    const due = new Date(dueAt).toISOString();
    const row = await store.insert(gate.userKey, "reminders", {
      title,
      dueAt: due,
      anchorAt: due,
      repeat,
      zone,
      done: false,
      doneAt: null,
      noteId: note ? note.id : null,
      notifiedAt: null,
    });
    refresh();
    return { ok: true, data: toClientReminder(row) };
  } catch (err) {
    return failure(err);
  }
}

/** Ticks a reminder off: a one-off is done, a series moves to its next occurrence. */
export async function completeReminder(id: unknown): Promise<ReminderResult<ClientReminder>> {
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const r = await own(gate.userKey, id);
    if (!r) return fail("not_found");
    const patch = completion(r, new Date());
    await getStore().update(gate.userKey, "reminders", r.id, patch);
    refresh();
    return { ok: true, data: toClientReminder({ ...r, ...patch }) };
  } catch (err) {
    return failure(err);
  }
}

/** Undoes a completion made by mistake: a one-off opens again, at its time. */
export async function reopenReminder(id: unknown): Promise<ReminderResult<ClientReminder>> {
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const r = await own(gate.userKey, id);
    if (!r) return fail("not_found");
    const patch = { done: false, doneAt: null, notifiedAt: null };
    await getStore().update(gate.userKey, "reminders", r.id, patch);
    refresh();
    return { ok: true, data: toClientReminder({ ...r, ...patch }) };
  } catch (err) {
    return failure(err);
  }
}

export async function snoozeReminder(id: unknown, choice: unknown): Promise<ReminderResult<ClientReminder>> {
  const pc = z.enum(["10m", "1h", "tomorrow", "nextWeek"]).safeParse(choice);
  if (!pc.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const r = await own(gate.userKey, id);
    if (!r) return fail("not_found");
    // This occurrence moves; a series keeps its anchor and its rhythm.
    const patch = { dueAt: snoozeUntil(pc.data as SnoozeChoice, new Date(), r.zone).toISOString(), notifiedAt: null, done: false };
    await getStore().update(gate.userKey, "reminders", r.id, patch);
    refresh();
    return { ok: true, data: toClientReminder({ ...r, ...patch }) };
  } catch (err) {
    return failure(err);
  }
}

const editSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  dueAt: momentSchema.optional(),
  repeat: z.enum(REPEATS).optional(),
});

/** Renames or reschedules. A new moment or rhythm restarts the series from it. */
export async function editReminder(id: unknown, input: unknown): Promise<ReminderResult<ClientReminder>> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const r = await own(gate.userKey, id);
    if (!r) return fail("not_found");
    const { title, dueAt, repeat } = parsed.data;
    const patch: Partial<DbReminder> = {};
    if (title !== undefined) patch.title = title;
    if (dueAt !== undefined || repeat !== undefined) {
      const due = dueAt ? new Date(dueAt).toISOString() : r.dueAt;
      Object.assign(patch, { dueAt: due, anchorAt: due, repeat: repeat ?? r.repeat, notifiedAt: null, done: false, doneAt: null });
    }
    await getStore().update(gate.userKey, "reminders", r.id, patch);
    refresh();
    return { ok: true, data: toClientReminder({ ...r, ...patch }) };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteReminder(id: unknown): Promise<ReminderResult<{ id: string }>> {
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const r = await own(gate.userKey, id);
    if (!r) return fail("not_found");
    await getStore().remove(gate.userKey, "reminders", r.id);
    refresh();
    return { ok: true, data: { id: r.id } };
  } catch (err) {
    return failure(err);
  }
}

/**
 * The page showed these reminders to the person: they will not be sent
 * again (to another open tab, or to Telegram). Only occurrences already due
 * can be marked — a page cannot silence a reminder in advance.
 */
export async function markRemindersNotified(ids: unknown): Promise<ReminderResult<{ marked: number }>> {
  const parsed = z.array(idSchema).max(50).safeParse(ids);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    const now = new Date();
    let marked = 0;
    for (const id of new Set(parsed.data)) {
      const r = await store.get(gate.userKey, "reminders", id);
      if (!r || r.done || Date.parse(r.dueAt) > now.getTime() + 60_000 || (r.notifiedAt && r.notifiedAt >= r.dueAt)) continue;
      await store.update(gate.userKey, "reminders", r.id, { notifiedAt: now.toISOString() });
      marked++;
    }
    return { ok: true, data: { marked } };
  } catch (err) {
    return failure(err);
  }
}
