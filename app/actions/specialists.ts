"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { quota } from "@/lib/ai/quota";
import { AIError } from "@/lib/ai/router";
import { getAuthenticatedUserKey } from "@/lib/db/store";
import { isLocale } from "@/lib/i18n/config";
import { getEdition } from "@/lib/plans/server";
import { availableSpecialistTools } from "@/lib/specialists/available";
import type { Specialist, SpecialistInput } from "@/lib/specialists/model";
import { NEED_MAX, proposeSpecialist } from "@/lib/specialists/propose";
import { saveSpecialistFor, specialistsReady, type SpecialistResult } from "@/lib/specialists/service";
import { getSpecialistStore } from "@/lib/specialists/store";

/**
 * Specialists, as actions: a signed-in person (an action can be called from
 * any page, so never the shared demo key), the edition that opens the agent,
 * migration 018 in place. The checks themselves live in
 * `lib/specialists/service.ts`, shared with the agent's own tool.
 */

export type ProposeCode = "unauthorized" | "edition" | "migration_pending" | "invalid" | "quota" | "rate_limit" | "unavailable" | "unusable" | "failed";
export type ProposeResult = { ok: true; data: SpecialistInput } | { ok: false; code: ProposeCode };

const idSchema = z.string().trim().min(1).max(64);

const refresh = () => {
  revalidatePath("/assistant/specialists");
  revalidatePath("/assistant");
};

export async function saveSpecialist(id: unknown, input: unknown): Promise<SpecialistResult<Specialist>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return { ok: false, code: "unauthorized" };
  const target = id === null ? null : idSchema.safeParse(id);
  if (target && !target.success) return { ok: false, code: "invalid" };
  try {
    const r = await saveSpecialistFor(userKey, target ? target.data : null, input);
    if (r.ok) refresh();
    return r;
  } catch (err) {
    console.error("[specialists] save failed", err instanceof Error ? err.message : err);
    return { ok: false, code: "failed" };
  }
}

export async function deleteSpecialist(id: unknown): Promise<SpecialistResult<null>> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return { ok: false, code: "unauthorized" };
  const target = idSchema.safeParse(id);
  if (!target.success) return { ok: false, code: "invalid" };
  const blocked = await specialistsReady();
  if (blocked) return { ok: false, code: blocked };
  try {
    if (!(await getSpecialistStore().remove(userKey, target.data))) return { ok: false, code: "not_found" };
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    console.error("[specialists] delete failed", err instanceof Error ? err.message : err);
    return { ok: false, code: "failed" };
  }
}

/** A specialist drafted from the owner's need, to review — nothing is saved. */
export async function proposeSpecialistDraft(need: unknown, locale: unknown): Promise<ProposeResult> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return { ok: false, code: "unauthorized" };
  const text = z.string().trim().min(3).max(NEED_MAX).safeParse(need);
  if (!text.success) return { ok: false, code: "invalid" };
  const blocked = await specialistsReady();
  if (blocked) return { ok: false, code: blocked };
  const edition = await getEdition();
  // A model call on LifeOS's budget: counted like a message to the agent.
  if (!quota().take(userKey, `agent_${edition}`).ok) return { ok: false, code: "quota" };
  try {
    const tools = (await availableSpecialistTools(edition)).map((t) => t.spec.name);
    const draft = await proposeSpecialist(text.data, typeof locale === "string" && isLocale(locale) ? locale : "en", tools);
    return draft ? { ok: true, data: draft } : { ok: false, code: "unusable" };
  } catch (err) {
    if (err instanceof AIError) return { ok: false, code: err.code === "rate_limit" ? "rate_limit" : err.code === "unavailable" ? "unavailable" : "unusable" };
    console.error("[specialists] proposal failed", err instanceof Error ? err.message : err);
    return { ok: false, code: "failed" };
  }
}
