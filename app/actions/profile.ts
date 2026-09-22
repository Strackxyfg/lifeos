"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserKey } from "@/lib/db/store";
import { loadStoredProfile, saveProfile } from "@/lib/user/profile";
import { AREA_IDS, LIMITS } from "@/lib/onboarding";

const schema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  profession: z.string().trim().max(LIMITS.profession),
  areas: z.array(z.enum(AREA_IDS)).max(AREA_IDS.length),
});

export type ProfileState = { ok: boolean; code?: "unauthorized" | "invalid" | "failed"; at?: number };

/**
 * Saves profile edits from Settings: to the database (so they follow the
 * person across devices) and to the display cookie. `at` makes each result a
 * distinct state, so saving twice in a row still shows feedback twice.
 */
export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const at = Date.now();
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return { ok: false, code: "unauthorized", at };

  const parsed = schema.safeParse({
    name: formData.get("name") ?? "",
    profession: formData.get("profession") ?? "",
    areas: formData.getAll("areas"),
  });
  if (!parsed.success) return { ok: false, code: "invalid", at };
  const { name, profession, areas } = parsed.data;

  try {
    const prior = await loadStoredProfile();
    await saveProfile(userKey, {
      name,
      profession: profession || null,
      answers: { ...(prior?.answers ?? {}), areas },
    });
    revalidatePath("/", "layout");
    return { ok: true, at };
  } catch (err) {
    console.error("[profile] save failed", err);
    return { ok: false, code: "failed", at };
  }
}
