import "server-only";
import { getStore, isSupabaseConfigured } from "@/lib/db/store";
import type { Edition } from "@/lib/plans/editions";
import { isEmailConfigured } from "@/lib/agent/email";
import { searchAvailable } from "@/lib/agent/search";
import { toolsFor, type AgentTool } from "@/lib/agent/tools";
import { SPECIALIST_TOOLS } from "./model";

/**
 * The tools a specialist may be given here and now: those the agent itself is
 * offered for this edition on this server (`toolsFor`), less orchestration.
 * What the editor shows, and what a proposed draft may contain.
 */
export async function availableSpecialistTools(edition: Edition): Promise<AgentTool[]> {
  const store = getStore();
  const [reminders, self] = await Promise.all([store.supportsReminders().catch(() => false), store.supportsSelf().catch(() => false)]);
  const allowed = new Set<string>(SPECIALIST_TOOLS);
  return toolsFor({ edition, supabase: isSupabaseConfigured(), email: isEmailConfigured(), reminders, self, search: searchAvailable() }).filter((t) => allowed.has(t.spec.name));
}
