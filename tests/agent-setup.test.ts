import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ONLINE_WITHIN_S, installCommand, isLocalOrigin, runnerState } from "@/lib/agent/runner-status";
import {
  LANG_PLACEHOLDER,
  RUNNER_FILES,
  URL_PLACEHOLDER,
  isRunnerFile,
  manifest,
  originFrom,
  prepare,
  readRunnerFile,
  sha256,
} from "@/lib/agent/runner-files";

const RUNNER_DIR = join(__dirname, "..", "agent-runner");
const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

describe("whether the agent runs, from what LifeOS saw", () => {
  it("tells no token, never heard, heard, and silent apart", () => {
    expect(runnerState({ tokenActive: false, lastSeen: ago(5) }, NOW)).toEqual({ state: "none", secondsAgo: null });
    expect(runnerState({ tokenActive: true, lastSeen: null }, NOW)).toEqual({ state: "never", secondsAgo: null });
    expect(runnerState({ tokenActive: true, lastSeen: ago(8) }, NOW)).toEqual({ state: "online", secondsAgo: 8 });
    expect(runnerState({ tokenActive: true, lastSeen: ago(ONLINE_WITHIN_S) }, NOW).state).toBe("online");
    expect(runnerState({ tokenActive: true, lastSeen: ago(ONLINE_WITHIN_S + 1) }, NOW)).toEqual({ state: "offline", secondsAgo: 91 });
    // A clock a little ahead of the database's never shows a negative time.
    expect(runnerState({ tokenActive: true, lastSeen: ago(-3) }, NOW)).toEqual({ state: "online", secondsAgo: 0 });
    expect(runnerState({ tokenActive: true, lastSeen: "not a date" }, NOW).state).toBe("never");
  });

  it("allows three idle polls and slack before calling it silent", () => {
    // The runner idles at POLL_MS = 10 s (agent-runner/Dockerfile).
    const dockerfile = readFileSync(join(RUNNER_DIR, "Dockerfile"), "utf8");
    const poll = Number(dockerfile.match(/ENV POLL_MS=(\d+)/)?.[1]);
    expect(poll).toBe(10000);
    expect(ONLINE_WITHIN_S * 1000).toBeGreaterThanOrEqual(poll * 3);
  });
});

describe("the install command", () => {
  it("has no secret in it, and speaks the person's language", () => {
    expect(installCommand("https://app.example.com/")).toBe('curl -fsSL "https://app.example.com/api/agent/runner/install.sh" | sudo bash');
    expect(installCommand("https://app.example.com", "fr")).toBe('curl -fsSL "https://app.example.com/api/agent/runner/install.sh?lang=fr" | sudo bash');
    expect(installCommand("https://app.example.com")).not.toMatch(/lifeos_agent_|token|key/i);
  });

  it("knows an address no server can reach", () => {
    for (const o of ["http://localhost:3000", "http://127.0.0.1:3001", "http://app.localhost", "http://192.168.1.20:3000", "http://10.0.0.5", "http://172.20.10.3:3001", "nonsense"]) {
      expect(isLocalOrigin(o), o).toBe(true);
    }
    for (const o of ["https://lifeos.example.com", "https://my-app.vercel.app", "https://172.32.0.1"]) {
      expect(isLocalOrigin(o), o).toBe(false);
    }
  });
});

describe("the files a server installs from", () => {
  it("serves exactly the files the image copies and the installer fetches", () => {
    const dockerfile = readFileSync(join(RUNNER_DIR, "Dockerfile"), "utf8");
    const copied = dockerfile.match(/^COPY --chown=\S+ (.+) \.\/$/m)?.[1].split(/\s+/) ?? [];
    const installer = readFileSync(join(RUNNER_DIR, "install.sh"), "utf8");
    const fetched = installer.match(/^RUNNER_FILES="([^"]+)"/m)?.[1].split(/\s+/) ?? [];
    const served = Object.keys(RUNNER_FILES).filter((f) => f !== "install.sh");
    // The image needs its .mjs files; the installer brings those and the two build files.
    expect(copied.sort()).toEqual(served.filter((f) => f.endsWith(".mjs")).sort());
    expect(fetched.sort()).toEqual(served.sort());
  });

  it("serves only its allowlist — no path from a request reaches the disk", () => {
    for (const evil of ["../.env.local", ".env", "..%2F.env.local", "index.mjs/../../package.json", "constructor", "__proto__", "toString"]) {
      expect(isRunnerFile(evil), evil).toBe(false);
    }
    expect(isRunnerFile("install.sh")).toBe(true);
  });

  it("writes this LifeOS's address and language into the installer, and nothing else anywhere", async () => {
    const source = await readRunnerFile("install.sh");
    expect(source).toContain(`"${URL_PLACEHOLDER}"`);
    expect(source).toContain(`"${LANG_PLACEHOLDER}"`);
    expect(source).not.toContain("\r\n");
    const served = prepare("install.sh", source, "https://app.example.com", "fr");
    expect(served).toContain('BAKED_URL="https://app.example.com"');
    expect(served).toContain('BAKED_LANG="fr"');
    expect(served).not.toContain(URL_PLACEHOLDER);
    // The script's own test for "not served" must survive the replacement.
    expect(served).toContain('case "$BAKED_URL" in __LIFEOS*) BAKED_URL="" ;; esac');
    // Any other language is left to the server's own setting.
    expect(prepare("install.sh", source, "https://a.example", "de; rm -rf /")).toContain(`BAKED_LANG="${LANG_PLACEHOLDER}"`);
    const index = await readRunnerFile("index.mjs");
    expect(prepare("index.mjs", index, "https://app.example.com", "fr")).toBe(index);
  });

  it("lists every file with the checksum of what is served", async () => {
    const { files } = await manifest();
    expect(Object.keys(files).sort()).toEqual(["Dockerfile", "docker-compose.yml", "index.mjs", "retry.mjs"]);
    expect(files["index.mjs"]).toBe(sha256(await readRunnerFile("index.mjs")));
    expect(files["index.mjs"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the address the request came to, before the configured one", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(originFrom(h({ "x-forwarded-host": "app.example.com", "x-forwarded-proto": "https" }), null, "http://localhost:3000")).toBe(
      "https://app.example.com"
    );
    expect(originFrom(h({ host: "my.example.org" }), "https://internal:3000/x", undefined)).toBe("https://my.example.org");
    expect(originFrom(h({}), null, "https://configured.example")).toBe("https://configured.example");
    expect(originFrom(h({ host: "evil.example\"; rm -rf /" }), null, "https://configured.example")).toBe("https://configured.example");
    // Accepted by a URL parser, shell syntax in a script: never written in.
    for (const host of ["a$(id).example", "a`id`.example", "a'b.example"]) {
      expect(originFrom(h({ host }), null, "https://configured.example"), host).toBe("https://configured.example");
    }
    expect(originFrom(h({ host: "[::1]:3000" }), null, undefined)).toBe("https://[::1]:3000");
    expect(originFrom(h({ host: "xn--caf-dma.example:8443", "x-forwarded-proto": "https" }), null, undefined)).toBe("https://xn--caf-dma.example:8443");
    expect(originFrom(h({}), null, "javascript:alert(1)")).toBeNull();
  });

  it("is a script bash can read", () => {
    const bash = spawnSync("bash", ["-n", join(RUNNER_DIR, "install.sh")], { encoding: "utf8" });
    // Where bash is not installed, there is nothing to run it with either.
    if (bash.error) return;
    expect(bash.stderr).toBe("");
    expect(bash.status).toBe(0);
  });
});
