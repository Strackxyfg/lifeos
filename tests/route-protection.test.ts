import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every page in the authenticated app must be covered by the middleware.
 *
 * Next.js requires `config.matcher` to be a static literal, so it cannot be
 * derived from the filesystem — which means adding a page and forgetting the
 * matcher leaves it publicly reachable, with nothing failing. That happened
 * here once: /agent and /assessment were public for a release. This test is
 * the missing link between the two lists.
 */

const ROOT = join(__dirname, "..");
const APP_GROUP = join(ROOT, "app", "(app)");

/** Top-level route segments under app/(app), e.g. "brain", "agent". */
function privateSegments(): string[] {
  return readdirSync(APP_GROUP).filter((name) => {
    const full = join(APP_GROUP, name);
    return statSync(full).isDirectory() && !name.startsWith("(") && !name.startsWith("_");
  });
}

/** The segments the middleware matcher protects, read from its source. */
function matchedSegments(): Set<string> {
  const src = readFileSync(join(ROOT, "middleware.ts"), "utf8");
  const block = src.slice(src.indexOf("matcher:"));
  const found = [...block.matchAll(/"\/([a-z0-9-]+)\/:path\*"/g)].map((m) => m[1]);
  return new Set(found);
}

describe("route protection", () => {
  const pages = privateSegments();
  const matched = matchedSegments();

  it("finds the private pages and the matcher it checks against", () => {
    // Guards the parsing itself: an empty list would make every assertion
    // below pass vacuously.
    expect(pages.length).toBeGreaterThan(5);
    expect(matched.size).toBeGreaterThan(5);
    expect(pages).toContain("brain");
    expect(pages).toContain("agent");
  });

  it("protects every page in the authenticated app", () => {
    const exposed = pages.filter((p) => !matched.has(p));
    expect(exposed, `publicly reachable: ${exposed.join(", ")}`).toEqual([]);
  });

  it("does not protect routes that no longer exist", () => {
    // A stale matcher entry is harmless on its own, but it is how the two
    // lists drift — and the next page added tends to be the one forgotten.
    const stale = [...matched].filter((m) => !pages.includes(m));
    expect(stale, `stale matcher entries: ${stale.join(", ")}`).toEqual([]);
  });
});
