import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Every API route must authenticate its caller.
 *
 * The middleware matcher covers pages only, so an API route is public unless
 * it checks for itself. That is how the assistant, insights, capture and
 * generation endpoints all shipped open: each one a free relay to the model
 * key, able to drain the daily token budget for every real user. This test
 * makes an unauthenticated route fail the build instead of failing in
 * production.
 */

const ROOT = join(__dirname, "..");
const API = join(ROOT, "app", "api");

/** The ways a route may prove who is calling. */
const MECHANISMS: { name: string; pattern: RegExp }[] = [
  { name: "user session", pattern: /\brequireUserKey\(|\bgetAuthenticatedUserKey\(/ },
  { name: "runner token", pattern: /\bauthenticateRunner\(/ },
  { name: "Telegram secret", pattern: /\bverifyWebhookSecret\(/ },
  { name: "Stripe signature", pattern: /\bconstructEvent\(/ },
];

/**
 * Routes that are deliberately public, each with the reason. Adding a route
 * here should be a conscious decision that shows up in review.
 */
const PUBLIC: Record<string, string> = {};

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routes(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

const all = routes(API).map((file) => ({
  route: relative(API, file).split(sep).slice(0, -1).join("/"),
  src: readFileSync(file, "utf8"),
}));

describe("API authentication", () => {
  it("finds the routes", () => {
    // Guards the walk itself: zero routes would make the next test pass vacuously.
    expect(all.length).toBeGreaterThan(8);
    expect(all.map((r) => r.route)).toContain("assistant");
  });

  it("authenticates every route that isn't deliberately public", () => {
    const open = all
      .filter((r) => !(r.route in PUBLIC))
      .filter((r) => !MECHANISMS.some((m) => m.pattern.test(r.src)))
      .map((r) => r.route);
    expect(open, `unauthenticated API routes: ${open.join(", ")}`).toEqual([]);
  });

  it("keeps the public allowlist free of routes that no longer exist", () => {
    const stale = Object.keys(PUBLIC).filter((p) => !all.some((r) => r.route === p));
    expect(stale).toEqual([]);
  });
});
