import path from "node:path";

/**
 * Where the local store keeps its files (no Supabase): `LIFEOS_DATA_DIR` when
 * set — the desktop app points it at the person's own application-data
 * folder — and `.data` beside the app otherwise.
 */
export function dataDir(): string {
  const dir = process.env.LIFEOS_DATA_DIR?.trim();
  return dir ? path.resolve(dir) : path.join(process.cwd(), ".data");
}
