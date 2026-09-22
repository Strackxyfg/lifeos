import { cache } from "react";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { isMissingTable } from "@/lib/db/errors";
import type { DbProfile, ProfilePatch } from "@/lib/db/types";
import { readProfileAnswers, type AreaId } from "@/lib/onboarding";

const PROFILE_COOKIE = "lifeos_profile";
const PROFILE_MAX_AGE = 60 * 60 * 24 * 30;

export interface Profile {
  /** Full display name. */
  name: string;
  /** First token of the name — used for greetings. */
  firstName: string;
  profession?: string;
  /** 1–2 letter avatar initials. */
  initials: string;
  email?: string;
  /** Parts of life the brain should help with. */
  areas: AreaId[];
  /** Whether onboarding has ever completed. */
  onboarded: boolean;
}

interface StoredProfile {
  /**
   * Whose profile this is. The cookie outlives a sign-out, so without an owner
   * the next person to sign in on the same browser was greeted by the
   * previous one's name. A cookie for someone else is ignored.
   */
  owner?: string;
  name?: string;
  profession?: string;
}

/** Derive a friendly first name from an email local-part ("quincy.skyll" → "Quincy"). */
function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const token = local.split(/[._\-0-9]/).filter(Boolean)[0] ?? "";
  return token ? token[0].toUpperCase() + token.slice(1) : "";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Email of the signed-in user — Supabase Auth when configured, else the demo session. */
async function currentEmail(): Promise<string | undefined> {
  const { isSupabaseConfigured } = await import("@/lib/db/store");
  if (isSupabaseConfigured()) {
    const { getSupabaseUser } = await import("@/lib/supabase/rls");
    const user = await getSupabaseUser();
    if (user?.email) return user.email;
  }
  return (await getSession())?.email;
}

async function readCookie(userKey: string): Promise<StoredProfile> {
  const raw = (await cookies()).get(PROFILE_COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString()) as StoredProfile;
    return parsed.owner === userKey ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The stored profile, or null — never an exception.
 *
 * Every page's layout reads the profile, so a failure here would take the
 * whole app down for what is display data. Before migration 007 the table is
 * missing and that is expected; any other error is logged and the cookie
 * copy is used instead.
 */
export const loadStoredProfile = cache(async function loadStoredProfile(): Promise<DbProfile | null> {
  try {
    const { getStore, getUserKey } = await import("@/lib/db/store");
    return await getStore().getProfile(await getUserKey());
  } catch (err) {
    if (!isMissingTable(err)) console.error("[profile] read failed", err);
    return null;
  }
});

/**
 * Resolve the current user's display profile for server components.
 *
 * The stored profile comes first: it follows the person across devices, where
 * the cookie only knows this browser. The cookie is the fallback (and the only
 * copy before migration 007), then a name derived from the email. Never throws.
 */
export const getProfile = cache(async function getProfile(): Promise<Profile> {
  const { getUserKey } = await import("@/lib/db/store");
  const userKey = await getUserKey();
  const [stored, cookie, email] = await Promise.all([loadStoredProfile(), readCookie(userKey), currentEmail()]);

  let name = stored?.name?.trim() || cookie.name?.trim() || (email ? deriveNameFromEmail(email) : "");
  if (!name) name = "there";

  return {
    name,
    firstName: name.split(/\s+/)[0],
    profession: stored?.profession?.trim() || cookie.profession?.trim() || undefined,
    initials: initialsOf(name === "there" ? "" : name),
    email,
    areas: readProfileAnswers(stored?.answers).areas,
    onboarded: Boolean(stored?.onboardedAt),
  };
});

/** Writes the display cookie — the fallback copy of name and profession. */
async function writeCookie(data: StoredProfile): Promise<void> {
  const store = await cookies();
  const value = Buffer.from(JSON.stringify(data)).toString("base64");
  store.set(PROFILE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PROFILE_MAX_AGE,
  });
}

/**
 * Persists the profile (call from a server action, with an authenticated key).
 *
 * `stored: false` means the profile table does not exist yet (migration 007
 * pending): name and profession survive in the cookie, the rest waits. Any
 * other failure throws — it is a real error, and the caller reports it.
 */
export async function saveProfile(userKey: string, patch: ProfilePatch): Promise<{ stored: boolean }> {
  const cookie = await readCookie(userKey);
  // A field present in the patch wins, even when it clears the value.
  const pick = (k: "name" | "profession") => (k in patch ? patch[k] ?? undefined : cookie[k]);
  await writeCookie({ owner: userKey, name: pick("name"), profession: pick("profession") });

  try {
    const { getStore } = await import("@/lib/db/store");
    await getStore().saveProfile(userKey, patch);
    return { stored: true };
  } catch (err) {
    if (isMissingTable(err)) return { stored: false };
    throw err;
  }
}

/** Drops the display cookie — after the person erased their data. */
export async function forgetProfileCookie(): Promise<void> {
  (await cookies()).delete(PROFILE_COOKIE);
}
