"use server";

import { z } from "zod";

const schema = z.object({
  // Normalized to lower case: the `waitlist` table stores lower-cased emails
  // (CHECK constraint) so a plain UNIQUE column gives case-insensitive
  // uniqueness and stays upsert-compatible.
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .transform((v) => v.toLowerCase()),
  role: z.string().max(80).optional(),
});

export type WaitlistState = {
  ok: boolean;
  message: string;
};

/**
 * Join the waitlist. In production this:
 *  1. Rate-limits by IP via Upstash Redis.
 *  2. Upserts into `waitlist` (Supabase) with source + UTM.
 *  3. Fires a welcome email + Slack ops notification.
 * Here we validate and return a typed result so the UI is fully wired.
 */
export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData
): Promise<WaitlistState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    role: formData.get("role") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // await ratelimit(ip); await supabase.from("waitlist").upsert(...)
  await new Promise((r) => setTimeout(r, 700));

  return {
    ok: true,
    message: "You're on the list. Check your inbox for early access.",
  };
}
