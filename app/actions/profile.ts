"use server";

import { z } from "zod";
import { setProfile } from "@/lib/user/profile";

const schema = z.object({
  name: z.string().min(1, "Name can't be empty.").max(60),
  profession: z.string().max(80).optional(),
});

export type ProfileState = { ok: boolean; message?: string; at?: number };

/**
 * Persist profile edits from Settings. Writes the same profile cookie the whole
 * app reads via getProfile(), so the greeting + sidebar update on refresh.
 * `at` makes each success a distinct state so repeated saves re-trigger the UI.
 */
export async function updateProfile(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    profession: (formData.get("profession") as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check your details.", at: Date.now() };
  }

  await setProfile({ name: parsed.data.name, profession: parsed.data.profession });
  return { ok: true, message: "Profile updated", at: Date.now() };
}
