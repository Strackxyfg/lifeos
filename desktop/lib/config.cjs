"use strict";

/**
 * The desktop app's settings: where LifeOS runs (on this computer, or the
 * person's LifeOS online) and the AI keys for the local mode.
 *
 * Keys are stored encrypted with the operating system's own protection
 * (Electron `safeStorage`: DPAPI on Windows, bound to the Windows account),
 * passed to the local server as environment variables, and never shown back:
 * the settings window only learns whether each one is set.
 *
 * Pure — the encryption is handed in — so it is tested without Electron.
 */

const PROVIDER_KEYS = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
});

const MODES = ["local", "cloud"];

/** An address to open in cloud mode: https, or a local address for testing a deployment. */
function cloudUrl(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 500) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

/** A stored config, whatever the file held: unknown fields dropped, bad values reset. */
function normalize(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const keys = {};
  if (src.keys && typeof src.keys === "object") {
    for (const p of Object.keys(PROVIDER_KEYS)) if (typeof src.keys[p] === "string" && src.keys[p]) keys[p] = src.keys[p];
  }
  const mode = MODES.includes(src.mode) ? src.mode : "local";
  const url = cloudUrl(src.cloudUrl);
  return { mode: mode === "cloud" && !url ? "local" : mode, cloudUrl: url, keys };
}

/** A key as a person pastes it: one token, no spaces, of a plausible length. */
function validKey(v) {
  return typeof v === "string" && /^[\x21-\x7e]{10,400}$/.test(v.trim());
}

/**
 * The settings after an update from the window. For each key: `undefined` or
 * `null` keeps it, `""` removes it, a string replaces it. Returns the new
 * config, or the name of what is wrong.
 */
function applyUpdate(config, update, encrypt) {
  const next = normalize(config);
  const u = update && typeof update === "object" ? update : {};
  if (u.mode !== undefined) {
    if (!MODES.includes(u.mode)) return { error: "mode" };
    next.mode = u.mode;
  }
  if (u.cloudUrl !== undefined) {
    if (u.cloudUrl === "" || u.cloudUrl === null) next.cloudUrl = null;
    else {
      const url = cloudUrl(u.cloudUrl);
      if (!url) return { error: "cloudUrl" };
      next.cloudUrl = url;
    }
  }
  if (next.mode === "cloud" && !next.cloudUrl) return { error: "cloudUrl" };
  const keys = u.keys && typeof u.keys === "object" ? u.keys : {};
  for (const [provider, value] of Object.entries(keys)) {
    if (!(provider in PROVIDER_KEYS)) return { error: "provider" };
    if (value === undefined || value === null) continue;
    if (value === "") {
      delete next.keys[provider];
      continue;
    }
    if (!validKey(value)) return { error: `key:${provider}` };
    next.keys[provider] = encrypt(value.trim());
  }
  return { config: next };
}

/** The environment the local server gets: each key decrypted; one that cannot be is left out. */
function envFor(config, decrypt) {
  const env = {};
  for (const [provider, cipher] of Object.entries(normalize(config).keys)) {
    try {
      const plain = decrypt(cipher);
      if (validKey(plain)) env[PROVIDER_KEYS[provider]] = plain;
    } catch {
      /* encrypted under another Windows account, or corrupted: skipped */
    }
  }
  return env;
}

/** What the settings window may know. */
function publicConfig(config) {
  const c = normalize(config);
  return {
    mode: c.mode,
    cloudUrl: c.cloudUrl,
    keys: Object.fromEntries(Object.keys(PROVIDER_KEYS).map((p) => [p, Boolean(c.keys[p])])),
  };
}

module.exports = { PROVIDER_KEYS, MODES, cloudUrl, normalize, validKey, applyUpdate, envFor, publicConfig };
