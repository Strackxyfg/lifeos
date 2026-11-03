import "server-only";
import { isSupabaseConfigured } from "@/lib/db/store";
import type { Specialist, SpecialistInput } from "./model";
import { localSpecialistStore } from "./store-local";
import { supabaseSpecialistStore } from "./store-supabase";

/**
 * Where specialists live: the database when Supabase is configured
 * (migration 018), the local data folder otherwise — one contract:
 *
 *  - each person sees and changes only their own;
 *  - at most `SPECIALIST_LIMITS.count` per person ("full" past it);
 *  - names are unique per person, whatever their case ("taken");
 *  - `erase` (the person erasing their data) removes them all.
 */

export type SaveRefusal = "missing" | "full" | "taken";

export interface SpecialistStore {
  supports(): Promise<boolean>;
  list(userKey: string): Promise<Specialist[]>;
  get(userKey: string, id: string): Promise<Specialist | null>;
  /** `id` null creates. */
  save(userKey: string, id: string | null, input: SpecialistInput): Promise<Specialist | SaveRefusal>;
  remove(userKey: string, id: string): Promise<boolean>;
  erase(userKey: string): Promise<void>;
}

export function getSpecialistStore(): SpecialistStore {
  return isSupabaseConfigured() ? supabaseSpecialistStore : localSpecialistStore;
}

/** Names compare without case or surrounding space: "Juriste" and "juriste " are one name. */
export const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("fr") === b.trim().toLocaleLowerCase("fr");
