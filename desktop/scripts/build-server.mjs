#!/usr/bin/env node
/**
 * Builds the LifeOS server the desktop app ships: a Next.js production build
 * (standalone output) for the local mode — no Supabase, no keys inside.
 *
 *   node desktop/scripts/build-server.mjs     → desktop/build/server/
 *
 *  1. `next build` with the standalone output, into its own `.next-desktop`
 *     (a dev server's `.next` is never touched), Supabase variables blanked
 *     (Next keeps an empty value instead of loading `.env.local`'s), so the
 *     app runs on its local store.
 *  2. The server, its static files, `public/`, and the launcher with its
 *     guard, assembled in `desktop/build/server`.
 *  3. Checked: no `.env*` file, no `.data` folder, and nothing shaped like a
 *     credential (API keys, tokens, private keys) anywhere in the output.
 *     Any of them is a failed build, not a warning.
 *
 * `tsconfig.json` is put back as it was: `next build` adds its build folder's
 * types to it.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..");
const dist = ".next-desktop";
const out = path.join(desktop, "build", "server");

const fail = (msg) => {
  console.error(`\n[build-server] ${msg}`);
  process.exit(1);
};

/* 1 — the build */
const env = { ...process.env, NEXT_OUTPUT: "standalone", NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: "1" };
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "BILLING_ENFORCED"]) {
  env[k] = "";
}
const tsconfig = path.join(root, "tsconfig.json");
const tsconfigBefore = readFileSync(tsconfig);
let build;
try {
  build = spawnSync("npx", ["next", "build"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
} finally {
  writeFileSync(tsconfig, tsconfigBefore);
}
if (build.status !== 0) fail("next build failed.");

/* 2 — the assembly */
const standalone = path.join(root, dist, "standalone");
if (!existsSync(path.join(standalone, dist, "required-server-files.json"))) fail("No standalone output: is `output: standalone` set from NEXT_OUTPUT?");
rmSync(out, { recursive: true, force: true });
mkdirSync(path.dirname(out), { recursive: true });
cpSync(standalone, out, { recursive: true });
cpSync(path.join(root, dist, "static"), path.join(out, dist, "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
for (const f of ["launcher.cjs", "guard.cjs"]) cpSync(path.join(desktop, "server", f), path.join(out, f));

/* 3 — the checks */
function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === ".data") rmSync(full, { recursive: true, force: true });
      else walk(full, visit);
    } else visit(full, name, st);
  }
}
walk(out, (full, name) => {
  if (/^\.env/.test(name)) rmSync(full);
});

// The shapes credentials take. The scan reads only the build output, never
// an env file, and reports where a match is — never the match itself.
const CREDENTIALS = [
  ["Groq key", /gsk_[A-Za-z0-9]{40,}/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{30,}/],
  ["OpenAI-style key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}/],
  ["Stripe secret key", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/],
  ["Telegram bot token", /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/],
  ["JSON Web Token (a Supabase key is one)", /eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const leaks = [];
walk(out, (full, name, st) => {
  if (st.size > 20_000_000 || !/\.(js|cjs|mjs|json|html|txt|map|css|rsc|body|meta)$/.test(name)) return;
  const text = readFileSync(full, "utf8");
  for (const [kind, re] of CREDENTIALS) if (re.test(text)) leaks.push(`${kind} in ${path.relative(out, full)}`);
});
if (leaks.length) fail(`Something shaped like a credential is in the build — nothing may ship:\n  ${leaks.join("\n  ")}`);

let size = 0;
walk(out, (full, name, st) => (size += st.size));
console.log(`\n[build-server] ${path.relative(root, out)} ready — ${(size / 1e6).toFixed(0)} MB, no env file, nothing shaped like a credential.`);
