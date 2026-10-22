"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedUserKey } from "@/lib/db/store";
import { isEdition, rank, type Edition } from "@/lib/plans/editions";
import { getEditionState } from "@/lib/plans/server";
import { loadStoredProfile, saveProfile } from "@/lib/user/profile";

export type EditionErrorCode = "unauthorized" | "invalid" | "payment_required" | "failed";
export type EditionResult = { ok: true; edition: Edition } | { ok: false; code: EditionErrorCode };

const fail = (code: EditionErrorCode): EditionResult => ({ ok: false, code });

/**
 * Changes the edition the person uses.
 *
 * During early access, any edition, in one click either way: what an edition
 * leaves out is hidden, never deleted. Once billing decides, an edition above
 * the one paid for is refused here — the page sends the person to checkout.
 */
export async function setEdition(input: unknown): Promise<EditionResult> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return fail("unauthorized");
  if (!isEdition(input)) return fail("invalid");

  const state = await getEditionState();
  if (state.billing && rank(input) > rank(state.entitled ?? "personal")) return fail("payment_required");

  try {
    const prior = await loadStoredProfile();
    const { stored } = await saveProfile(userKey, { answers: { ...(prior?.answers ?? {}), edition: input } });
    // Before migration 007 the profile lives in a cookie that has no room
    // for answers: the choice would not survive the next page.
    if (!stored) return fail("failed");
    revalidatePath("/", "layout");
    return { ok: true, edition: input };
  } catch (err) {
    console.error("[edition]", err);
    return fail("failed");
  }
}
