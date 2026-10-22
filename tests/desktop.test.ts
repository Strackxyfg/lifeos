import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Windows app: its settings (keys encrypted, never shown back), where
 * its window may go, who may reach its local server — and the security
 * settings of its windows, read from the source.
 */

const require = createRequire(import.meta.url);
const config = require("../desktop/lib/config.cjs");
const nav = require("../desktop/lib/navigation.cjs");
const guard = require("../desktop/server/guard.cjs");
const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// A reversible stand-in for Windows' encryption.
const encrypt = (s: string) => `enc(${Buffer.from(s).toString("base64")})`;
const decrypt = (s: string) => {
  const m = s.match(/^enc\((.*)\)$/);
  if (!m) throw new Error("bad");
  return Buffer.from(m[1], "base64").toString();
};

describe("settings", () => {
  it("starts on this computer, and resets what a file should not hold", () => {
    expect(config.normalize(undefined)).toEqual({ mode: "local", cloudUrl: null, keys: {} });
    expect(config.normalize({ mode: "cloud", cloudUrl: "http://evil.example", keys: { groq: "x", nope: "y" }, extra: 1 })).toEqual({ mode: "local", cloudUrl: null, keys: { groq: "x" } });
    expect(config.normalize({ mode: "cloud", cloudUrl: "https://app.lifeos.example/path?q" })).toMatchObject({ mode: "cloud", cloudUrl: "https://app.lifeos.example" });
  });

  it("accepts https addresses (and local ones for testing), nothing else", () => {
    expect(config.cloudUrl("https://lifeos.example")).toBe("https://lifeos.example");
    expect(config.cloudUrl("http://localhost:3000/x")).toBe("http://localhost:3000");
    expect(config.cloudUrl("http://lifeos.example")).toBeNull();
    expect(config.cloudUrl("https://user:pw@lifeos.example")).toBeNull();
    expect(config.cloudUrl("javascript:alert(1)")).toBeNull();
    expect(config.cloudUrl("file:///C:/x")).toBeNull();
  });

  it("encrypts a new key, keeps one left empty, removes one asked to", () => {
    const first = config.applyUpdate({}, { keys: { anthropic: "sk-ant-0123456789abcdef", groq: "gsk_0123456789abcdef" } }, encrypt);
    expect(first.config.keys.anthropic).toBe(encrypt("sk-ant-0123456789abcdef"));
    const second = config.applyUpdate(first.config, { keys: { anthropic: null, groq: "" } }, encrypt);
    expect(Object.keys(second.config.keys)).toEqual(["anthropic"]);
    expect(config.envFor(second.config, decrypt)).toEqual({ ANTHROPIC_API_KEY: "sk-ant-0123456789abcdef" });
  });

  it("refuses what is not a key, an unknown provider, cloud without an address", () => {
    expect(config.applyUpdate({}, { keys: { openai: "sk with spaces" } }, encrypt)).toEqual({ error: "key:openai" });
    expect(config.applyUpdate({}, { keys: { openai: "short" } }, encrypt)).toEqual({ error: "key:openai" });
    expect(config.applyUpdate({}, { keys: { stealer: "0123456789abcdef" } }, encrypt)).toEqual({ error: "provider" });
    expect(config.applyUpdate({}, { mode: "cloud" }, encrypt)).toEqual({ error: "cloudUrl" });
    expect(config.applyUpdate({}, { mode: "cloud", cloudUrl: "http://x.example" }, encrypt)).toEqual({ error: "cloudUrl" });
    expect(config.applyUpdate({}, { mode: "ftp" }, encrypt)).toEqual({ error: "mode" });
  });

  it("never shows a key back — only whether it is set", () => {
    const c = config.applyUpdate({}, { keys: { deepseek: "sk-0123456789abcdef" } }, encrypt).config;
    const shown = config.publicConfig(c);
    expect(shown.keys.deepseek).toBe(true);
    expect(shown.keys.openai).toBe(false);
    expect(JSON.stringify(shown)).not.toContain("0123456789abcdef");
    expect(JSON.stringify(shown)).not.toContain(encrypt("sk-0123456789abcdef"));
  });

  it("skips a key Windows cannot decrypt (another account, a corrupted file)", () => {
    expect(config.envFor({ keys: { groq: "garbage", openai: encrypt("sk-0123456789abcdef") } }, decrypt)).toEqual({ OPENAI_API_KEY: "sk-0123456789abcdef" });
  });
});

describe("where the window may go", () => {
  const local = ["http://127.0.0.1:51234"];
  const cloud = ["https://app.lifeos.example", "https://*.supabase.co"];

  it("keeps LifeOS inside, and only LifeOS", () => {
    expect(nav.isAllowedNavigation("http://127.0.0.1:51234/brain?x=1", local)).toBe(true);
    expect(nav.isAllowedNavigation("http://127.0.0.1:51235/", local)).toBe(false);
    expect(nav.isAllowedNavigation("http://localhost:51234/", local)).toBe(false);
    expect(nav.isAllowedNavigation("https://evil.example/", local)).toBe(false);
    expect(nav.isAllowedNavigation("https://app.lifeos.example/hub", cloud)).toBe(true);
    expect(nav.isAllowedNavigation("https://abc.supabase.co/auth/v1/authorize", cloud)).toBe(true);
  });

  it("is not fooled by look-alike hosts", () => {
    expect(nav.isAllowedNavigation("https://abc.supabase.co.evil.example/", cloud)).toBe(false);
    expect(nav.isAllowedNavigation("https://evilsupabase.co/", cloud)).toBe(false);
    expect(nav.isAllowedNavigation("http://abc.supabase.co/", cloud)).toBe(false);
    expect(nav.isAllowedNavigation("https://abc.supabase.co:8443/", cloud)).toBe(false);
    expect(nav.isAllowedNavigation("https://app.lifeos.example@evil.example/", cloud)).toBe(false);
    expect(nav.isAllowedNavigation("not a url", cloud)).toBe(false);
  });

  it("hands only web and mail links to the system", () => {
    expect(nav.isExternalSafe("https://example.com")).toBe(true);
    expect(nav.isExternalSafe("mailto:a@b.co")).toBe(true);
    expect(nav.isExternalSafe("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(nav.isExternalSafe("ms-settings:")).toBe(false);
    expect(nav.isExternalSafe("javascript:alert(1)")).toBe(false);
  });
});

describe("who may reach the local server", () => {
  const token = "a".repeat(64);
  const opts = { port: 51234, token };

  it("lets the app's window in", () => {
    expect(guard.allowed({ host: "127.0.0.1:51234", cookie: `lifeos_session=x; lifeos_desktop=${token}` }, opts)).toBe(true);
    expect(guard.allowed({ host: "localhost:51234", cookie: `lifeos_desktop=${token}` }, opts)).toBe(true);
  });

  it("refuses DNS rebinding, other ports, another browser, a wrong or partial secret", () => {
    expect(guard.allowed({ host: "evil.example:51234", cookie: `lifeos_desktop=${token}` }, opts)).toBe(false);
    expect(guard.allowed({ host: "127.0.0.1:51235", cookie: `lifeos_desktop=${token}` }, opts)).toBe(false);
    expect(guard.allowed({ host: "127.0.0.1:51234" }, opts)).toBe(false);
    expect(guard.allowed({ host: "127.0.0.1:51234", cookie: `lifeos_desktop=${"b".repeat(64)}` }, opts)).toBe(false);
    expect(guard.allowed({ host: "127.0.0.1:51234", cookie: `lifeos_desktop=${token.slice(1)}` }, opts)).toBe(false);
    expect(guard.allowed({ host: "127.0.0.1:51234", cookie: "lifeos_desktop=" }, opts)).toBe(false);
    expect(guard.allowed({ host: "127.0.0.1:51234", cookie: `xlifeos_desktop=${token}` }, opts)).toBe(false);
  });
});

describe("the app's source", () => {
  const main = read("desktop/main.cjs");

  it("locks every window down", () => {
    const windows = main.match(/new BrowserWindow\(\{[\s\S]*?webPreferences: \{[^}]*\}/g) ?? [];
    expect(windows.length).toBe(2);
    for (const w of windows) {
      expect(w).toContain("contextIsolation: true");
      expect(w).toContain("sandbox: true");
      expect(w).toContain("nodeIntegration: false");
      expect(w).not.toContain("webSecurity: false");
    }
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toContain('"will-navigate"');
    expect(main).toContain('"will-redirect"');
    expect(main).toContain("setPermissionRequestHandler");
    expect(main).toContain("requestSingleInstanceLock");
  });

  it("serves locally only, with a secret per launch, data in the person's folder", () => {
    expect(main).toContain('HOSTNAME: "127.0.0.1"');
    expect(main).toContain("crypto.randomBytes(32)");
    expect(main).toContain('LIFEOS_DATA_DIR: path.join(app.getPath("userData"), "data")');
    expect(read("desktop/server/launcher.cjs")).toContain('server.listen(port, "127.0.0.1"');
    expect(read("desktop/server/launcher.cjs")).toContain("allowed(req.headers, { port, token })");
  });

  it("ships no secret: Supabase blanked, .env files removed, the output scanned", () => {
    const build = read("desktop/scripts/build-server.mjs");
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) expect(build).toContain(`"${k}"`);
    expect(build).toContain("shaped like a credential is in the build");
    // The scan reads the output only, never an env file.
    expect(build).not.toMatch(/readFileSync\([^)]*\.env/);
    expect(read("desktop/package.json")).toContain('"!**/.env*"');
  });

  it("pins its tools to exact versions", () => {
    const pkg = JSON.parse(read("desktop/package.json"));
    for (const [name, v] of Object.entries(pkg.devDependencies as Record<string, string>)) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
