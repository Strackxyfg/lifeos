import "server-only";
import { SPECIALIST_LIMITS } from "./model";
import { saveSpecialistFor, type SpecialistCode } from "./service";

/** The agent creating a specialist the owner asked for (`specialist_create`). */

const WHY: Record<SpecialistCode, string> = {
  unauthorized: "The owner is not signed in.",
  edition: "Specialists are not part of the owner's edition.",
  migration_pending: "Specialists need database migration 018 — nothing was saved.",
  invalid: "Something in the specialist is not valid",
  not_found: "That specialist no longer exists.",
  taken: "A specialist already has that name: choose another, or tell the owner to change the existing one on the specialists page.",
  full: `The owner already has ${SPECIALIST_LIMITS.count} specialists, the most there can be: one must be removed first.`,
  failed: "Saving failed.",
};

export async function createSpecialistFor(userKey: string, payload: Record<string, unknown>): Promise<{ ok: true; detail: string; data: string } | { ok: false; error: string }> {
  const r = await saveSpecialistFor(userKey, null, payload);
  if (!r.ok) return { ok: false, error: r.code === "invalid" && r.field ? `${WHY.invalid}: ${r.field}.` : WHY[r.code] };
  const s = r.data;
  return {
    ok: true,
    detail: `Created the specialist "${s.name}".`,
    data: [
      `Specialist created [${s.id}]: "${s.name}" — ${s.description}`,
      `Tools: ${s.tools.length ? s.tools.join(", ") : "none"}. Depth: ${s.depth}.`,
      "The owner can talk to it from the conversation's selector, and change it on the specialists page (/assistant/specialists). It can be given tasks from their next message.",
    ].join("\n"),
  };
}
