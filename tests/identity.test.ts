import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Who a request acts as.
 *
 * The demo session cookie is plain base64 — anyone can write one naming any
 * email, or any user id. It identifies the person only in the demo (no
 * Supabase). With Supabase configured it used to be read as a fallback when
 * nobody was signed in: a forged cookie named a user's id, and the agent's
 * actions — which use the admin client, past row-level security — minted a
 * runner token for that account. These tests keep that door shut.
 */

const user = { current: null as { id: string } | null };
const session = { current: null as { email: string } | null };
vi.mock("@/lib/supabase/rls", () => ({ getSupabaseUser: async () => user.current, createRlsClient: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => session.current }));

const ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
let saved: Record<string, string | undefined> = {};

describe("the caller's identity", () => {
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    user.current = null;
    session.current = null;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("with Supabase, never takes the demo cookie's word for who is signed in", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
    const { getUserKey, getAuthenticatedUserKey } = await import("@/lib/db/store");
    const { DEMO_USER_KEY } = await import("@/lib/db/seed");
    session.current = { email: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" };
    expect(await getUserKey()).toBe(DEMO_USER_KEY);
    expect(await getAuthenticatedUserKey()).toBeNull();
    user.current = { id: "a-real-user" };
    expect(await getUserKey()).toBe("a-real-user");
    expect(await getAuthenticatedUserKey()).toBe("a-real-user");
  });

  it("without Supabase (the demo), the cookie is the session", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { getUserKey, getAuthenticatedUserKey } = await import("@/lib/db/store");
    session.current = { email: "camille@test.local" };
    expect(await getUserKey()).toBe("camille@test.local");
    expect(await getAuthenticatedUserKey()).toBe("camille@test.local");
  });
});

const ROOT = join(__dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("the admin client", () => {
  it("is only ever used for the signed-in user (never a fallback identity)", () => {
    // The admin client skips row-level security: whoever the key names, it
    // reads and writes. A file that uses it must name the caller with
    // getAuthenticatedUserKey (null when signed out), or a token/secret of its own.
    // Comments may name the function (to say why it is not used); code may not.
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const offenders = [...sources(join(ROOT, "app")), ...sources(join(ROOT, "lib"))]
      .map((file) => ({ file: relative(ROOT, file).split(sep).join("/"), src: code(readFileSync(file, "utf8")) }))
      .filter((f) => /\bcreateAdminClient\(/.test(f.src) && /\bgetUserKey\(\)/.test(f.src))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });
});
