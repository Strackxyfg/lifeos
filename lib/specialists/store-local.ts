import { randomUUID } from "node:crypto";
import { jsonFile } from "@/lib/db/json-file";
import { fromStored, SPECIALIST_LIMITS, type Specialist } from "./model";
import { sameName, type SpecialistStore } from "./store";

/** Specialists without Supabase: `specialists.json` in the local data folder, with the rules of `store.ts`. */

const file = jsonFile<Record<string, Specialist[]>>("specialists.json", () => ({}));
const now = () => new Date().toISOString();
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const byName = (a: Specialist, b: Specialist) => a.name.localeCompare(b.name, "fr");
const read = (s: Specialist) => fromStored(s as unknown as Specialist & Record<string, unknown>);

export const localSpecialistStore: SpecialistStore = {
  async supports() {
    return true;
  },

  // The file can be edited by hand: what is read goes through `fromStored`.
  list: (userKey) => file.read((d) => copy(d[userKey] ?? []).map(read).sort(byName)),
  get: (userKey, id) =>
    file.read((d) => {
      const s = d[userKey]?.find((x) => x.id === id);
      return s ? read(copy(s)) : null;
    }),

  save: (userKey, id, input) =>
    file.mutate((d) => {
      const mine = (d[userKey] ??= []);
      if (mine.some((s) => s.id !== id && sameName(s.name, input.name))) return "taken" as const;
      if (id === null) {
        if (mine.length >= SPECIALIST_LIMITS.count) return "full" as const;
        const s: Specialist = { ...copy(input), id: randomUUID(), createdAt: now(), updatedAt: now() };
        mine.push(s);
        return copy(s);
      }
      const i = mine.findIndex((s) => s.id === id);
      if (i < 0) return "missing" as const;
      mine[i] = { ...mine[i], ...copy(input), updatedAt: now() };
      return read(copy(mine[i]));
    }),

  remove: (userKey, id) =>
    file.mutate((d) => {
      const mine = d[userKey] ?? [];
      const i = mine.findIndex((s) => s.id === id);
      if (i < 0) return false;
      mine.splice(i, 1);
      return true;
    }),

  async erase(userKey) {
    await file.mutate((d) => void delete d[userKey]);
  },
};
