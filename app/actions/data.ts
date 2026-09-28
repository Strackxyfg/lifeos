"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { forgetProfileCookie } from "@/lib/user/profile";
import { getTeamStore } from "@/lib/team/store";

export type DeleteResult = { ok: true } | { ok: false; code: "unauthorized" | "invalid" | "failed" };

/** The confirmation word, in either language — whichever the person was shown. */
const CONFIRM_WORDS = new Set(["DELETE", "SUPPRIMER"]);

/**
 * Erases everything the person has in LifeOS: notes and their connections,
 * projects, deals, transactions, tasks, reminders, the profile — and their
 * place in every team, with what they shared there (a team they own passes
 * to its longest-standing admin, or is deleted if they were alone in it).
 *
 * The typed confirmation is checked here, not only in the form: a server
 * action is a public endpoint, and a destructive one must not depend on the
 * client having behaved. The strict key means a signed-out call can never
 * reach the shared demo data either.
 *
 * Not transactional — tables are cleared one by one — but idempotent, so a
 * failure halfway is completed by running it again. The UI says exactly that.
 */
export async function deleteMyData(confirmation: unknown): Promise<DeleteResult> {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return { ok: false, code: "unauthorized" };

  const word = typeof confirmation === "string" ? confirmation.trim().toUpperCase() : "";
  if (!CONFIRM_WORDS.has(word)) return { ok: false, code: "invalid" };

  try {
    // Teams first: they only reference the person, nothing depends on them.
    const teams = getTeamStore();
    if (await teams.supportsTeams()) await teams.forget(userKey);
    await getStore().clear(userKey);
    await forgetProfileCookie();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[data] delete failed", err);
    return { ok: false, code: "failed" };
  }
}
