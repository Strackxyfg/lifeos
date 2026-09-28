import "server-only";
import { createHash } from "node:crypto";
import { isSupabaseConfigured } from "@/lib/db/store";
import { localTeamStore } from "./local";
import { supabaseTeamStore } from "./supabase";
import type { TeamStore } from "./types";

/** The active team store: Supabase when configured, the local file otherwise. */
export function getTeamStore(): TeamStore {
  return isSupabaseConfigured() ? supabaseTeamStore : localTeamStore;
}

/**
 * How the page names a member: an opaque id, never their account key (an
 * email in the file store, the auth uid in Supabase). Stable within a team,
 * different across teams, so it cannot be used to follow someone around.
 */
export function memberId(teamId: string, userKey: string): string {
  return createHash("sha256").update(`member:${teamId}:${userKey}`).digest("hex").slice(0, 20);
}

/** An invitation link's token → what is stored. The token itself is never kept. */
export function inviteHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
