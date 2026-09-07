"use server";

import { onboardingSchema, type OnboardingAnswers } from "@/lib/onboarding";
import { generateWorkspace } from "@/lib/notion/generate";
import { createAdminClient } from "@/lib/supabase/admin";

export type GenerateResult =
  | { ok: true; manifestId: string; databaseCount: number }
  | { ok: false; error: string };

/**
 * Server action: build a user's workspace end-to-end.
 * Validates answers, loads the user's Notion connection, runs the generator,
 * and persists the manifest. Intended to be invoked from /generate after OAuth.
 */
export async function generate(
  userId: string,
  rawAnswers: unknown
): Promise<GenerateResult> {
  const parsed = onboardingSchema.safeParse(rawAnswers);
  if (!parsed.success) {
    return { ok: false, error: "Please complete onboarding before generating." };
  }
  const answers: OnboardingAnswers = parsed.data;

  const db = createAdminClient();
  const { data: conn } = await db
    .from("notion_connections")
    .select("access_token, root_page_id")
    .eq("user_id", userId)
    .single();

  if (!conn?.access_token || !conn.root_page_id) {
    return { ok: false, error: "Connect Notion to continue." };
  }

  try {
    const manifest = await generateWorkspace({
      token: conn.access_token,
      rootPageId: conn.root_page_id,
      answers,
    });

    const { data: saved } = await db
      .from("workspaces")
      .insert({ user_id: userId, manifest, profile: answers })
      .select("id")
      .single();

    return { ok: true, manifestId: saved?.id ?? "", databaseCount: manifest.databases.length };
  } catch (err) {
    console.error("Generation failed", err);
    return { ok: false, error: "Generation failed. We didn't charge you — try again." };
  }
}
