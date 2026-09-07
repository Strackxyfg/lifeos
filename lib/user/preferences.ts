import { cookies } from "next/headers";

const PREFS_COOKIE = "lifeos_prefs";
const PREFS_MAX_AGE = 60 * 60 * 24 * 365;

/** Integration + automation toggles shown in Settings. */
export type PreferenceKey =
  | "notion" | "google" | "gmail" | "slack" | "github" | "stripe"
  | "weeklyReview" | "dailySummary" | "atRiskAlerts";

export type Preferences = Record<PreferenceKey, boolean>;

export const defaultPreferences: Preferences = {
  notion: true,
  google: true,
  gmail: true,
  slack: false,
  github: false,
  stripe: true,
  weeklyReview: true,
  dailySummary: true,
  atRiskAlerts: false,
};

export async function getPreferences(): Promise<Preferences> {
  const store = await cookies();
  const raw = store.get(PREFS_COOKIE)?.value;
  if (!raw) return defaultPreferences;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString()) as Partial<Preferences>;
    return { ...defaultPreferences, ...parsed };
  } catch {
    return defaultPreferences;
  }
}

export async function writePreferences(prefs: Preferences): Promise<void> {
  const store = await cookies();
  store.set(PREFS_COOKIE, Buffer.from(JSON.stringify(prefs)).toString("base64"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PREFS_MAX_AGE,
  });
}
