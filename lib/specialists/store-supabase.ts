import { createRlsClient } from "@/lib/supabase/rls";
import { fromStored, type Specialist } from "./model";
import type { SpecialistStore } from "./store";

/**
 * Specialists in Supabase (migration 018), through the request's own session:
 * the row-level policy keeps each person to their rows, a unique index keeps
 * names apart, a trigger keeps the count (`018_specialists.sql`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = { id: string; name: string; data: Omit<Specialist, "id" | "name" | "createdAt" | "updatedAt">; created_at: string; updated_at: string };
const COLUMNS = "id, name, data, created_at, updated_at";

// Rows can be written past the page (the owner's own API access): each one is read through `fromStored`.
const toSpecialist = (r: Row): Specialist =>
  fromStored({ ...(r.data && typeof r.data === "object" ? r.data : {}), id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at });

const fail = (what: string, message: string): never => {
  throw new Error(`[specialists] ${what}: ${message}`);
};

let probed: { value: boolean; until: number } | null = null;

export const supabaseSpecialistStore: SpecialistStore = {
  async supports() {
    if (probed && Date.now() < probed.until) return probed.value;
    const db = await createRlsClient();
    const { error } = await db.from("lifeos_specialists").select("id, name, data").limit(1);
    probed = { value: !error, until: error ? Date.now() + 60_000 : Number.POSITIVE_INFINITY };
    return !error;
  },

  async list(userKey) {
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_specialists").select(COLUMNS).eq("user_key", userKey).order("name");
    if (error) fail("list", error.message);
    return ((data ?? []) as Row[]).map(toSpecialist);
  },

  async get(userKey, id) {
    if (!UUID.test(id)) return null;
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_specialists").select(COLUMNS).eq("user_key", userKey).eq("id", id).maybeSingle();
    if (error) fail("get", error.message);
    return data ? toSpecialist(data as Row) : null;
  },

  async save(userKey, id, input) {
    const db = await createRlsClient();
    const { name, ...rest } = input;
    const query =
      id === null
        ? db.from("lifeos_specialists").insert({ user_key: userKey, name, data: rest }).select(COLUMNS).single()
        : UUID.test(id)
          ? db.from("lifeos_specialists").update({ name, data: rest, updated_at: new Date().toISOString() }).eq("user_key", userKey).eq("id", id).select(COLUMNS).maybeSingle()
          : null;
    if (!query) return "missing";
    const { data, error } = await query;
    if (error) {
      if (error.code === "23505") return "taken";
      if (error.message.includes("specialists_full")) return "full";
      fail("save", error.message);
    }
    return data ? toSpecialist(data as Row) : "missing";
  },

  async remove(userKey, id) {
    if (!UUID.test(id)) return false;
    const db = await createRlsClient();
    const { data, error } = await db.from("lifeos_specialists").delete().eq("user_key", userKey).eq("id", id).select("id");
    if (error) fail("remove", error.message);
    return (data ?? []).length > 0;
  },

  async erase(userKey) {
    const db = await createRlsClient();
    const { error } = await db.from("lifeos_specialists").delete().eq("user_key", userKey);
    if (error) fail("erase", error.message);
  },
};
