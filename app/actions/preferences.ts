"use server";

import {
  defaultPreferences, getPreferences, writePreferences,
  type PreferenceKey,
} from "@/lib/user/preferences";

/** Persist a single toggle. Returns the value actually stored. */
export async function togglePreference(
  key: string,
  value: boolean
): Promise<{ ok: boolean; value: boolean }> {
  if (!(key in defaultPreferences)) return { ok: false, value };
  const prefs = await getPreferences();
  prefs[key as PreferenceKey] = value;
  await writePreferences(prefs);
  return { ok: true, value };
}
