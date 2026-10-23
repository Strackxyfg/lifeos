import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 30_000 });
import { runCode } from "@/lib/agent/sandbox";

describe("probe", () => {
  it("computes", async () => {
    expect(await runCode("console.log('hi'); [1,2,3].reduce((a,b)=>a+b,0) * 2")).toEqual({ ok: true, value: "12", logs: "hi" });
  });
  it("stops an endless loop", async () => {
    const t = Date.now();
    const r = await runCode("while(true){}");
    expect(r.ok).toBe(false);
    expect(Date.now() - t).toBeLessThan(8000);
  });
  it("has nothing of the host", async () => {
    expect(await runCode("typeof require + typeof process + typeof fetch + typeof globalThis.Deno")).toMatchObject({ ok: true, value: "undefinedundefinedundefinedundefined" });
  });
});
