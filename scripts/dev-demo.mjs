#!/usr/bin/env node
/**
 * LifeOS in demo mode — no Supabase, nothing touches production data.
 *
 *   npm run dev:demo            → http://localhost:3001
 *
 * Storage falls back to the local file adapter (`.data/`, gitignored) and
 * sign-in to the demo session cookie. Sign in as `demo@lifeos.ai` to get the
 * sample workspace; any other address starts empty, exactly like a real new
 * account does.
 *
 * It builds into its own `.next-demo/`. Two dev servers sharing `.next/`
 * corrupt each other's RSC payloads, so this can run alongside `npm run dev`.
 *
 * AI keys are kept, so the assistant and summaries still work. Set
 * DEMO_NO_AI=1 to exercise the deterministic no-AI fallbacks instead.
 */
import { spawn } from "node:child_process";

const env = { ...process.env, NEXT_DIST_DIR: ".next-demo" };

// Blank rather than delete: Next only loads .env.local for keys that are
// *undefined*, so an empty string is what stops the real value coming back.
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]) {
  env[k] = "";
}
if (process.env.DEMO_NO_AI) {
  for (const k of ["GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENAI_API_KEY"]) env[k] = "";
}

const port = process.env.PORT ?? "3001";
const child = spawn("npx", ["next", "dev", "-p", port], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
