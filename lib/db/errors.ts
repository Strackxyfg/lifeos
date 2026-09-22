/**
 * A table that a pending migration will create — as opposed to a real failure.
 *
 * Code deploys the moment it is pushed; migrations are applied by hand. In
 * between, the new table does not exist, and treating that like any other
 * error would take down every page that reads it. Postgres says 42P01,
 * PostgREST says PGRST205 / "schema cache".
 *
 * Lives here, with no imports, so both the adapters and the data loaders can
 * use it without an import cycle.
 */
export function isMissingTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /PGRST205|42P01|schema cache|does not exist/i.test(msg);
}
