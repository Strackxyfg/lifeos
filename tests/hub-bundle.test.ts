import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The hub page must not pull the 3D engine into its first download: the
 * scene (three.js, React Three Fiber, the shaders) arrives on its own, while
 * the page shows the sky of the moment. One runtime import from `./scene`
 * put 240 kB back into the page's first load; this keeps it out.
 */

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const imports = (src: string) => [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)].map((m) => ({ typeOnly: !!m[1], from: m[2] }));

describe("the hub's first download", () => {
  it("takes only types from the scene", () => {
    for (const file of ["components/hub/hub.tsx", "components/hub/hub-hud.tsx"]) {
      const runtime = imports(read(file)).filter((i) => !i.typeOnly && (i.from.startsWith("./scene") || i.from === "./hub-scene"));
      expect(runtime.map((i) => `${file}: ${i.from}`)).toEqual([]);
    }
  });

  it("never imports three.js or React Three Fiber from the page's own modules", () => {
    for (const file of ["components/hub/hub.tsx", "components/hub/hub-hud.tsx", "components/hub/pacer-store.ts"]) {
      const heavy = imports(read(file)).filter((i) => !i.typeOnly && (i.from === "three" || i.from.startsWith("three/") || i.from.startsWith("@react-three/")));
      expect(heavy.map((i) => `${file}: ${i.from}`)).toEqual([]);
    }
  });
});
