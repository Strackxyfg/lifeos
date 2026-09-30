"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import type { DbBrainItem } from "@/lib/db/types";
import { isValidZone } from "@/lib/reminders/zoned";
import { parseReminder } from "@/lib/reminders/parse";
import { localDayHour } from "@/lib/self/rhythm";
import { isQuestionId } from "@/lib/self/questions";
import { DIMENSIONS, SAME_TRAIT, likeness, mergeEvidence, notesToRead, traitKey, type Dimension, type TraitLike } from "@/lib/self/portrait";
import { toCheckin, toTrait, type SelfData } from "@/lib/self/store";
import { isAdviceKey } from "@/lib/self/advice";
import { isDoubleAction, type DoubleAction } from "@/lib/self/double";
import { classifyNote } from "@/lib/ai/classify";
import { AIError, aiAvailable } from "@/lib/ai/router";
import { quota } from "@/lib/ai/quota";
import { toBrainNotes } from "@/lib/brain/load";
import { canonicalPair, sameLink, toBrainLink, type BrainLink, type BrainNote } from "@/lib/brain/graph";
import { sourceOf, type RelationKind } from "@/lib/brain/relations";
import { kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { fill, type Locale } from "@/lib/i18n/config";

/**
 * The double's actions: checking in, answering the day's question, letting
 * the double read notes for the portrait, the person's word on each trait,
 * what they do with advice, and the actions the double proposes in
 * conversation, once accepted.
 *
 * Every one needs a signed-in person — never the shared demo identity: this
 * is the most personal data the product keeps — validates whatever the page
 * sent, checks that every note it names is the person's own, and reports a
 * failure as a code the page words.
 */

export type SelfErrorCode = "invalid" | "unauthorized" | "not_found" | "migration_pending" | "failed" | "unavailable" | "rate_limit" | "duplicate";
export type SelfResult<T> = { ok: true; data: T } | { ok: false; code: SelfErrorCode };

const done = <T>(data: T): SelfResult<T> => ({ ok: true, data });
const fail = (code: SelfErrorCode): SelfResult<never> => ({ ok: false, code });

function failure(err: unknown): SelfResult<never> {
  if (isMissingTable(err)) return fail("migration_pending");
  if (err instanceof AIError) return fail(err.code === "rate_limit" ? "rate_limit" : err.code === "unavailable" ? "unavailable" : "failed");
  console.error("[self]", err);
  return fail("failed");
}

function refresh() {
  revalidatePath("/brain");
  revalidatePath("/brain/double");
  revalidatePath("/hub");
}

/** Signed in, and migration 015 applied. */
async function ready(): Promise<{ userKey: string } | SelfResult<never>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  if (!(await getStore().supportsSelf())) return fail("migration_pending");
  return { userKey };
}

const localeSchema = z.enum(["fr", "en"]);
const idSchema = z.string().trim().min(1).max(64);
const zoneSchema = z.string().refine(isValidZone);
const scale = z.number().int().min(1).max(5).nullable().optional();

/** A stored note, as the page shows it. */
function asNote(row: DbBrainItem, locale: Locale): BrainNote {
  return toBrainNotes([row], dictionaries[locale])[0];
}

/** Draws a connection the person made (or accepted), if the brain keeps connections. */
async function connect(userKey: string, a: DbBrainItem, b: DbBrainItem, kind: RelationKind, origin: "user" | "suggested", reason: string): Promise<BrainLink | null> {
  const store = getStore();
  try {
    const existing = (await store.list(userKey, "links")).find((l) => sameLink(l, a.id, b.id));
    if (existing) return toBrainLink(existing);
    const [fromId, toId] = canonicalPair(a.id, b.id);
    const typed = await store.supportsSynapses();
    const link = await store.insert(userKey, "links", {
      fromId,
      toId,
      reason: reason.slice(0, 300),
      origin,
      ...(typed ? { kind, sourceId: sourceOf(kind, a, b) } : {}),
    });
    return toBrainLink(link);
  } catch (err) {
    // Before migration 007 there are no connections: the note is kept anyway.
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/* ── Checking in, and the day's question ─────────────────────────── */

const checkinSchema = z
  .object({
    mood: scale,
    energy: scale,
    questionId: z.string().max(120).nullable().optional(),
    answer: z.string().trim().max(2_000).nullable().optional(),
    zone: zoneSchema,
    locale: localeSchema,
  })
  .refine((c) => c.mood != null || c.energy != null || (c.questionId && c.answer), "Nothing to record.")
  .refine((c) => !c.answer || (c.questionId && isQuestionId(c.questionId)), "An answer answers a question.");

export interface CheckinSaved {
  checkin: SelfData["checkins"][number];
  /** The note the answer became, with the connections it was given. */
  note: BrainNote | null;
  links: BrainLink[];
}

/**
 * How they are, and — when they answered it — the day's question. The answer
 * becomes a note in their brain, filed where it belongs, with the question
 * it answers beside it; an answer about a goal or a tension is connected to
 * it. The words are kept exactly as written.
 */
export async function checkIn(input: unknown): Promise<SelfResult<CheckinSaved>> {
  const parsed = checkinSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  const { mood, energy, questionId, answer, zone, locale } = parsed.data;
  const m = dictionaries[locale];
  try {
    const store = getStore();
    const { userKey } = gate;
    let note: DbBrainItem | null = null;
    const links: BrainLink[] = [];

    if (answer && questionId) {
      // The question, in their language, from what it is about.
      let question: string | null = null;
      let about: DbBrainItem[] = [];
      if (questionId.startsWith("goal:")) {
        const goal = await store.get(userKey, "brain", questionId.slice(5));
        if (!goal || goal.category !== "goals") return fail("not_found");
        question = fill(m.self.question.goal, { title: asNote(goal, locale).title });
        about = [goal];
      } else if (questionId.startsWith("tension:")) {
        const link = (await store.list(userKey, "links")).find((l) => l.id === questionId.slice(8));
        const a = link ? await store.get(userKey, "brain", link.fromId) : null;
        const b = link ? await store.get(userKey, "brain", link.toId) : null;
        if (!a || !b) return fail("not_found");
        question = fill(m.self.question.tension, { a: asNote(a, locale).title, b: asNote(b, locale).title });
        about = [a, b];
      } else {
        question = (m.self.questions as Record<string, string>)[questionId] ?? null;
      }
      if (!question) return fail("invalid");

      // A reflection, filed as one: an answer is not a goal or a task to do.
      const { category } = await classifyNote(answer, locale);
      const region: BrainCategoryId = category === "goals" || category === "next" ? "thoughts" : category;
      note = await store.insert(userKey, "brain", {
        title: answer.slice(0, 500),
        detail: fill(m.self.question.answerOf, { q: question }),
        category: region,
        kind: kindForCategory[region],
        seedKey: null,
        done: false,
        ai: false,
      });
      for (const other of about) {
        const l = await connect(userKey, note, other, "related", "user", fill(m.self.question.answerOf, { q: question }));
        if (l) links.push(l);
      }
    }

    const at = new Date();
    const { day, hour } = localDayHour(at, zone);
    const row = await store.insert(userKey, "checkins", {
      at: at.toISOString(),
      day,
      hour,
      mood: mood ?? null,
      energy: energy ?? null,
      questionId: answer ? questionId ?? null : null,
      noteId: note?.id ?? null,
    });
    refresh();
    return done({ checkin: toCheckin(row), note: note ? asNote(note, locale) : null, links });
  } catch (err) {
    return failure(err);
  }
}

/* ── The portrait ────────────────────────────────────────────────── */

export interface PortraitRead {
  added: TraitLike[];
  /** Traits already held that gained quotes, as they are now. */
  updated: TraitLike[];
}

const readSchema = z.object({ noteIds: z.array(idSchema).max(30).optional(), locale: localeSchema });

/**
 * The double reads notes — those given (an answer just written), or the ones
 * that say most about the person — and proposes traits, each resting on
 * quotes checked word for word (`sanitizeTraits`). Proposals wait for the
 * person's word; quotes for traits already held are added to them.
 */
export async function readForPortrait(input: unknown): Promise<SelfResult<PortraitRead>> {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  if (!aiAvailable()) return fail("unavailable");
  const allowed = quota().take(gate.userKey, "portrait");
  if (!allowed.ok) return fail("rate_limit");
  const { noteIds, locale } = parsed.data;
  try {
    const store = getStore();
    const [items, rows] = await Promise.all([store.list(gate.userKey, "brain"), store.list(gate.userKey, "traits")]);
    const notes = toBrainNotes(items, dictionaries[locale]);
    const traits = rows.map(toTrait).filter((t): t is TraitLike => t !== null);
    const pick = notesToRead(notes, traits, { only: noteIds, limit: 30 });
    if (pick.length === 0) return done({ added: [], updated: [] });

    const { extractTraits } = await import("@/lib/ai/self-ai");
    const found = await extractTraits({ notes: pick, traits, locale });
    const now = new Date().toISOString();

    const added: TraitLike[] = [];
    for (const p of found.proposals) {
      try {
        const row = await store.insert(gate.userKey, "traits", {
          dimension: p.dimension,
          statement: p.statement,
          evidence: p.evidence,
          status: "proposed",
          origin: "ai",
          key: p.key,
          updatedAt: now,
        });
        const t = toTrait(row);
        if (t) added.push(t);
      } catch (err) {
        // The same trait written a moment ago by another reading: skip it.
        if (!/duplicate|unique/i.test(String(err))) throw err;
      }
    }
    const byId = new Map(traits.map((t) => [t.id, t]));
    const updated: TraitLike[] = [];
    for (const s of found.support) {
      const t = byId.get(s.traitId);
      if (!t) continue;
      const evidence = mergeEvidence(t.evidence, s.evidence);
      if (evidence.length === t.evidence.length) continue;
      await store.update(gate.userKey, "traits", t.id, { evidence, updatedAt: now });
      updated.push({ ...t, evidence, updatedAt: now });
    }
    if (added.length || updated.length) refresh();
    return done({ added, updated });
  } catch (err) {
    return failure(err);
  }
}

/** Another trait of theirs saying the same, in the same dimension — rejected ones aside. */
function sameAs(traits: TraitLike[], dimension: Dimension, statement: string, except?: string): TraitLike | undefined {
  const key = traitKey(statement);
  return traits.find(
    (t) => t.id !== except && t.dimension === dimension && t.status !== "rejected" && (t.key === key || likeness(t.statement, statement) >= SAME_TRAIT)
  );
}

async function ownTrait(userKey: string, id: unknown): Promise<{ trait: TraitLike; all: TraitLike[] } | null> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return null;
  const all = (await getStore().list(userKey, "traits")).map(toTrait).filter((t): t is TraitLike => t !== null);
  const trait = all.find((t) => t.id === pid.data);
  return trait ? { trait, all } : null;
}

/** "That's me" or "Not me". A rejected trait is kept, so nothing like it is proposed again. */
export async function judgeTrait(id: unknown, verdict: unknown): Promise<SelfResult<TraitLike>> {
  const pv = z.enum(["confirmed", "rejected"]).safeParse(verdict);
  if (!pv.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const own = await ownTrait(gate.userKey, id);
    if (!own) return fail("not_found");
    const updatedAt = new Date().toISOString();
    await getStore().update(gate.userKey, "traits", own.trait.id, { status: pv.data, updatedAt });
    refresh();
    return done({ ...own.trait, status: pv.data, updatedAt });
  } catch (err) {
    return failure(err);
  }
}

const statementSchema = z.string().trim().min(3).max(200);

/** Their correction: the trait becomes theirs, in their words, confirmed. Its quotes stay. */
export async function correctTrait(id: unknown, statement: unknown): Promise<SelfResult<TraitLike>> {
  const ps = statementSchema.safeParse(statement);
  if (!ps.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const own = await ownTrait(gate.userKey, id);
    if (!own) return fail("not_found");
    if (sameAs(own.all, own.trait.dimension, ps.data, own.trait.id)) return fail("duplicate");
    const patch = { statement: ps.data, key: traitKey(ps.data) || ps.data.toLowerCase().slice(0, 240), status: "confirmed" as const, origin: "person" as const, updatedAt: new Date().toISOString() };
    await getStore().update(gate.userKey, "traits", own.trait.id, patch);
    refresh();
    return done({ ...own.trait, ...patch });
  } catch (err) {
    return failure(err);
  }
}

const addSchema = z.object({ dimension: z.enum(DIMENSIONS), statement: statementSchema });

/** Something true about them, in their own words: confirmed from the start. */
export async function addTrait(input: unknown): Promise<SelfResult<TraitLike>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    const all = (await store.list(gate.userKey, "traits")).map(toTrait).filter((t): t is TraitLike => t !== null);
    const { dimension, statement } = parsed.data;
    if (sameAs(all, dimension, statement)) return fail("duplicate");
    const key = traitKey(statement) || statement.toLowerCase().slice(0, 240);
    // The same words rejected before: the person now says they are true.
    const rejected = all.find((t) => t.dimension === dimension && t.key === key && t.status === "rejected");
    const updatedAt = new Date().toISOString();
    if (rejected) {
      const patch = { statement, status: "confirmed" as const, origin: "person" as const, updatedAt };
      await store.update(gate.userKey, "traits", rejected.id, patch);
      refresh();
      return done({ ...rejected, ...patch });
    }
    const row = await store.insert(gate.userKey, "traits", { dimension, statement, evidence: [], status: "confirmed", origin: "person", key, updatedAt });
    refresh();
    const t = toTrait(row);
    return t ? done(t) : fail("failed");
  } catch (err) {
    return failure(err);
  }
}

/** Removes a trait they wrote themselves. One the double proposed is rejected instead, and remembered. */
export async function removeTrait(id: unknown): Promise<SelfResult<{ id: string; rejected: boolean }>> {
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const own = await ownTrait(gate.userKey, id);
    if (!own) return fail("not_found");
    const store = getStore();
    if (own.trait.origin === "person" && own.trait.evidence.length === 0) {
      await store.remove(gate.userKey, "traits", own.trait.id);
      refresh();
      return done({ id: own.trait.id, rejected: false });
    }
    await store.update(gate.userKey, "traits", own.trait.id, { status: "rejected", updatedAt: new Date().toISOString() });
    refresh();
    return done({ id: own.trait.id, rejected: true });
  } catch (err) {
    return failure(err);
  }
}

/* ── Advice ──────────────────────────────────────────────────────── */

/** Advice set aside for good, put off for a week, or done. */
export async function adviceState(key: unknown, status: unknown): Promise<SelfResult<{ adviceKey: string; status: "dismissed" | "snoozed" | "done"; until: string | null }>> {
  const ps = z.enum(["dismissed", "snoozed", "done"]).safeParse(status);
  if (!ps.success || !isAdviceKey(key)) return fail("invalid");
  const gate = await ready();
  if ("ok" in gate) return gate;
  try {
    const store = getStore();
    const until = ps.data === "snoozed" ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null;
    const updatedAt = new Date().toISOString();
    const existing = (await store.list(gate.userKey, "advice")).find((a) => a.adviceKey === key);
    if (existing) await store.update(gate.userKey, "advice", existing.id, { status: ps.data, until, updatedAt });
    else await store.insert(gate.userKey, "advice", { adviceKey: key, status: ps.data, until, updatedAt });
    return done({ adviceKey: key, status: ps.data, until });
  } catch (err) {
    return failure(err);
  }
}

/* ── What the double proposed, accepted ──────────────────────────── */

const acceptSchema = z.object({ zone: zoneSchema, locale: localeSchema });

export interface Accepted {
  note: BrainNote | null;
  links: BrainLink[];
  reminder: { title: string; dueAt: string } | null;
}

/**
 * An action the double proposed in conversation, accepted by the person:
 * a next step (connected to the goal it serves, if it named one of theirs),
 * a note, or a reminder at the moment they would say — read by the same
 * rules as every reminder; a moment that cannot be read is refused, never
 * guessed.
 */
export async function acceptDoubleAction(action: unknown, context: unknown): Promise<SelfResult<Accepted>> {
  const pc = acceptSchema.safeParse(context);
  if (!pc.success || !isDoubleAction(action)) return fail("invalid");
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  const { zone, locale } = pc.data;
  const a = action as DoubleAction;
  try {
    const store = getStore();
    if (a.type === "reminder") {
      if (!(await store.supportsReminders())) return fail("migration_pending");
      const parsed = parseReminder(`${a.title} ${a.when}`, new Date(), zone, locale);
      if (!parsed.dueAt || parsed.dueAt.getTime() <= Date.now()) return fail("invalid");
      const title = (parsed.title.trim() || a.title).slice(0, 300);
      const due = parsed.dueAt.toISOString();
      await store.insert(userKey, "reminders", {
        title,
        dueAt: due,
        anchorAt: due,
        repeat: parsed.repeat,
        zone,
        done: false,
        doneAt: null,
        noteId: null,
        notifiedAt: null,
      });
      refresh();
      revalidatePath("/dashboard");
      return done({ note: null, links: [], reminder: { title, dueAt: due } });
    }

    const region: BrainCategoryId = a.type === "step" ? "next" : a.region;
    const note = await store.insert(userKey, "brain", {
      title: a.title,
      detail: null,
      category: region,
      kind: kindForCategory[region],
      seedKey: null,
      done: false,
      // Proposed by the double, kept by the person: marked, like every note a model wrote.
      ai: true,
    });
    const links: BrainLink[] = [];
    if (a.type === "step" && a.goalId) {
      const goal = await store.get(userKey, "brain", a.goalId);
      if (goal && goal.category === "goals") {
        const l = await connect(userKey, note, goal, "advances", "suggested", dictionaries[locale].self.talk.linkReason);
        if (l) links.push(l);
      }
    }
    refresh();
    return done({ note: asNote(note, locale), links, reminder: null });
  } catch (err) {
    return failure(err);
  }
}
