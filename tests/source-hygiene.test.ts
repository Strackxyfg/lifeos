import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * No raw control characters in source.
 *
 * Twice a literal NUL ended up inside a string or a regex where an escape
 * sequence was meant — an editing tool had decoded the escape on write. The
 * code still ran, so nothing failed, but git then treats the file as binary:
 * its diff reads "Bin 4258 -> 4263 bytes", and a change to it can no longer
 * be reviewed. Tab, LF and CR are the only control characters source needs.
 *
 * Written with character codes rather than escapes, for the same reason.
 */

const ROOT = join(__dirname, "..");
const ALLOWED = new Set([9, 10, 13]); // tab, line feed, carriage return

function firstControl(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 && !ALLOWED.has(c)) return c;
  }
  return -1;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|mjs|sql|css)$/.test(name)) out.push(full);
  }
  return out;
}

describe("source hygiene", () => {
  const sources = [
    ...["app", "components", "lib", "tests", "supabase", "scripts"].flatMap((d) => {
      try {
        return files(join(ROOT, d));
      } catch {
        return [];
      }
    }),
    join(ROOT, "middleware.ts"),
  ];

  it("scans the source tree", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("finds a control character when there is one", () => {
    // Guards the detector itself, so a broken check cannot pass vacuously.
    expect(firstControl(`a${String.fromCharCode(0)}b`)).toBe(0);
    expect(firstControl("tab\tnewline\r\n")).toBe(-1);
  });

  it("contains no raw control characters", () => {
    const hits = sources
      .map((f) => ({ f, c: firstControl(readFileSync(f, "utf8")) }))
      .filter(({ c }) => c >= 0)
      .map(({ f, c }) => `${relative(ROOT, f)} (code ${c})`);
    expect(hits, `raw control characters in: ${hits.join(", ")}`).toEqual([]);
  });
});
