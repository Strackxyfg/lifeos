import { cache } from "react";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";

const PROFILE_COOKIE = "lifeos_profile";
const PROFILE_MAX_AGE = 60 * 60 * 24 * 30;

export interface Profile {
  /** Full display name. */
  name: string;
  /** First token of the name — used for greetings. */
  firstName: string;
  profession?: string;
  plan: string;
  /** 1–2 letter avatar initials. */
  initials: string;
  email?: string;
}

interface StoredProfile {
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

/**
 * Resolve the current user's display profile for server components.
 * Prefers the onboarding profile cookie, falls back to a name derived from the
 * session email, then to a neutral default. Never throws.
 */
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

export const getProfile = cache(async function getProfile(): Promise<Profile> {
  const store = await cookies();
  const raw = store.get(PROFILE_COOKIE)?.value;

  let stored: StoredProfile = {};
  if (raw) {
    try {
      stored = JSON.parse(Buffer.from(raw, "base64").toString()) as StoredProfile;
    } catch {}
  }

  const email = await currentEmail();
  let name = stored.name?.trim() || (email ? deriveNameFromEmail(email) : "");
  if (!name) name = "there";

  return {
    name,
    firstName: name.split(/\s+/)[0],
    profession: stored.profession,
    plan: "Pro",
    initials: initialsOf(name === "there" ? "" : name),
    email,
  };
});

/** Persist the onboarding profile (call from a server action). */
export async function setProfile(data: StoredProfile): Promise<void> {
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
