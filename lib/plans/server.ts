import "server-only";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/db/store";
import { readProfileAnswers } from "@/lib/onboarding";
import { loadStoredProfile } from "@/lib/user/profile";
import {
  PAID_STATUSES,
  editionFor,
  editionOfPlan,
  includes,
  resolveEdition,
  type Edition,
  type EditionState,
  type Feature,
} from "./editions";

/**
 * Which edition the signed-in person uses, and the checks every page,
 * action and route makes with it.
 *
 * The chosen edition lives in the profile, which the person may write —
 * that is what makes changing it one click during early access. What they
 * pay for lives in `subscriptions`, which only the Stripe webhook writes
 * (service role; the person can read their row, never write it), and once
 * billing is on (`BILLING_ENFORCED=1`, Supabase only) it caps the choice.
 */

export function billingEnforced(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.BILLING_ENFORCED ?? "") && isSupabaseConfigured();
}

/** The edition the person's subscription pays for, or null. Read through RLS, as them. */
async function entitlement(): Promise<Edition | null> {
  const { createRlsClient, getSupabaseUser } = await import("@/lib/supabase/rls");
  const user = await getSupabaseUser();
  if (!user) return null;
  const { data, error } = await (await createRlsClient())
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    // Unknown means unpaid: a failed read must not open what is not paid for.
    console.error("[editions] subscription read failed", error.message);
    return null;
  }
  if (!data || !(PAID_STATUSES as readonly string[]).includes(String(data.status))) return null;
  return editionOfPlan(data.plan);
}

export const getEditionState = cache(async function getEditionState(): Promise<EditionState> {
  const billing = billingEnforced();
  const [stored, entitled] = await Promise.all([loadStoredProfile(), billing ? entitlement() : Promise.resolve(null)]);
  const chosen = readProfileAnswers(stored?.answers).edition ?? null;
  return { edition: resolveEdition(chosen, entitled, billing), chosen, entitled, billing };
});

export async function getEdition(): Promise<Edition> {
  return (await getEditionState()).edition;
}

export async function canUse(feature: Feature): Promise<boolean> {
  return includes(await getEdition(), feature);
}

/**
 * Null when the person's edition opens the feature; otherwise the edition
 * that would. For server actions: `if (await locked("crm")) return fail(...)`.
 */
export async function locked(feature: Feature): Promise<Edition | null> {
  return (await canUse(feature)) ? null : editionFor(feature);
}

/** The refusal an API route sends for a feature outside the edition, or null. */
export async function featureRefusal(feature: Feature): Promise<Response | null> {
  const needed = await locked(feature);
  if (!needed) return null;
  return Response.json({ error: "edition", feature, needed }, { status: 403 });
}
