"use server";

import { z } from "zod";
import { setProfile } from "@/lib/user/profile";

const schema = z.object({
  name: z.string().max(60).optional(),
  profession: z.string().max(80).optional(),
});

/**
 * Called when the onboarding wizard completes. Persists the display profile so
 * the whole app (dashboard greeting, sidebar, settings) is personalized.
 * In production this also upserts `profiles.onboarding` in Supabase.
 */
export async function completeOnboarding(answers: unknown): Promise<{ ok: boolean }> {
  const parsed = schema.safeParse(answers);
  const name = parsed.success ? parsed.data.name : undefined;
  const profession = parsed.success ? parsed.data.profession : undefined;
  await setProfile({ name, profession });
  return { ok: true };
}
