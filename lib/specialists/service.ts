import "server-only";
import { locked } from "@/lib/plans/server";
import { specialistSchema, type Specialist } from "./model";
import { getSpecialistStore } from "./store";

/**
 * Saving a specialist, with every check — the same whether the owner does it
 * on the specialists page or asks the agent to: the edition that opens the
 * agent, migration 018 in place, the input valid, the name free, the count
 * under the cap.
 */

export type SpecialistCode = "unauthorized" | "edition" | "migration_pending" | "invalid" | "not_found" | "taken" | "full" | "failed";
export type SpecialistResult<T> = { ok: true; data: T } | { ok: false; code: SpecialistCode; field?: string };

export async function specialistsReady(): Promise<"edition" | "migration_pending" | null> {
  if (await locked("agent")) return "edition";
  if (!(await getSpecialistStore().supports())) return "migration_pending";
  return null;
}

export async function saveSpecialistFor(userKey: string, id: string | null, input: unknown): Promise<SpecialistResult<Specialist>> {
  const blocked = await specialistsReady();
  if (blocked) return { ok: false, code: blocked };
  const parsed = specialistSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", field: String(parsed.error.issues[0]?.path[0] ?? "") };
  const saved = await getSpecialistStore().save(userKey, id, parsed.data);
  if (saved === "missing") return { ok: false, code: "not_found" };
  if (saved === "taken" || saved === "full") return { ok: false, code: saved };
  return { ok: true, data: saved };
}
