import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Specialists kept and changed: each person's own, names unique whatever
 * their case, at most thirty, gone with an erasure; the actions behind the
 * page (signed in, edition, input), a specialist proposed from a need — only
 * with tools the owner may give, never half-valid — and one created by the agent.
 */

vi.setConfig({ testTimeout: 30_000 });

const h = vi.hoisted(() => ({
  user: { current: "ada@x.test" as string | null },
  locked: { current: null as string | null },
  answer: { current: "" as string | Error },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/plans/server", () => ({ locked: async () => h.locked.current, getEdition: async () => "team" }));
vi.mock("@/lib/db/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/store")>();
  return { ...real, getAuthenticatedUserKey: async () => h.user.current };
});
vi.mock("@/lib/ai/router", () => {
  class AIError extends Error {
    constructor(
      public readonly code: "unavailable" | "rate_limit" | "failed",
      message: string
    ) {
      super(message);
    }
  }
  return {
    AIError,
    ai: () => ({
      routes: [],
      // Web search is set up here (an OpenRouter route, at rest): a specialist may be given it.
      health: () => [{ id: "openrouter:m", provider: "openrouter", model: "m", tier: "frontier", openUntil: 0 }],
      complete: async (req: { validate?: (text: string) => boolean }) => {
        if (h.answer.current instanceof Error) throw h.answer.current;
        if (req.validate && !req.validate(h.answer.current)) throw new AIError("failed", "no usable answer");
        return { value: h.answer.current, route: { id: "test" } };
      },
    }),
  };
});

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lifeos-specialists-"));
  process.env.LIFEOS_DATA_DIR = dir;
});
afterAll(() => {
  delete process.env.LIFEOS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const input = (name: string) => ({ name, description: "Lit les contrats.", instructions: "Tu lis les contrats.", tools: ["web_search" as const], depth: "deep" as const });
const store = async () => (await import("@/lib/specialists/store-local")).localSpecialistStore;

describe("the local store", () => {
  it("keeps each person's own, sorted by name, and changes them in place", async () => {
    const s = await store();
    const b = await s.save("ada@x.test", null, input("Zoé"));
    const a = await s.save("ada@x.test", null, input("Avocat"));
    expect(typeof a === "object" && typeof b === "object").toBe(true);
    expect((await s.list("ada@x.test")).map((x) => x.name)).toEqual(["Avocat", "Zoé"]);
    expect(await s.list("eve@x.test")).toEqual([]);
    expect(await s.get("eve@x.test", (a as { id: string }).id)).toBeNull();
    const before = a as { id: string; createdAt: string };
    const changed = await s.save("ada@x.test", before.id, { ...input("Avocat"), depth: "fast" });
    expect(changed).toMatchObject({ id: before.id, createdAt: before.createdAt, depth: "fast" });
    expect(await s.save("eve@x.test", before.id, input("Vol"))).toBe("missing");
  });

  it("keeps names unique whatever their case, and stops at thirty", async () => {
    const s = await store();
    expect(await s.save("ada@x.test", null, input(" avocat "))).toBe("taken");
    for (let i = (await s.list("ada@x.test")).length; i < 30; i++) expect(typeof (await s.save("ada@x.test", null, input(`S${i}`)))).toBe("object");
    expect(await s.save("ada@x.test", null, input("Un de trop"))).toBe("full");
    // Changing one stays possible at the cap.
    const first = (await s.list("ada@x.test"))[0];
    expect(typeof (await s.save("ada@x.test", first.id, { ...input(first.name), description: "Autre." }))).toBe("object");
  });

  it("removes one, and erases them all with the person's data", async () => {
    const s = await store();
    const first = (await s.list("ada@x.test"))[0];
    expect(await s.remove("ada@x.test", first.id)).toBe(true);
    expect(await s.remove("ada@x.test", first.id)).toBe(false);
    await s.erase("ada@x.test");
    expect(await s.list("ada@x.test")).toEqual([]);
  });
});

describe("the actions behind the page", () => {
  it("refuse a signed-out caller and an edition without the agent", async () => {
    const a = await import("@/app/actions/specialists");
    h.user.current = null;
    expect(await a.saveSpecialist(null, input("X"))).toEqual({ ok: false, code: "unauthorized" });
    expect(await a.proposeSpecialistDraft("un juriste", "fr")).toEqual({ ok: false, code: "unauthorized" });
    h.user.current = "ada@x.test";
    h.locked.current = "personal";
    expect(await a.saveSpecialist(null, input("X"))).toEqual({ ok: false, code: "edition" });
    h.locked.current = null;
  });

  it("save what is valid, name what is not, and delete", async () => {
    const a = await import("@/app/actions/specialists");
    expect(await a.saveSpecialist(null, { ...input("X"), name: "" })).toMatchObject({ ok: false, code: "invalid", field: "name" });
    expect(await a.saveSpecialist(null, { ...input("X"), tools: ["research"] })).toMatchObject({ ok: false, code: "invalid", field: "tools" });
    const saved = await a.saveSpecialist(null, input("Juriste"));
    expect(saved).toMatchObject({ ok: true, data: { name: "Juriste" } });
    expect(await a.saveSpecialist(null, input("JURISTE"))).toEqual({ ok: false, code: "taken" });
    const id = (saved as { data: { id: string } }).data.id;
    expect(await a.deleteSpecialist(id)).toEqual({ ok: true, data: null });
    expect(await a.deleteSpecialist(id)).toEqual({ ok: false, code: "not_found" });
  });

  it("propose a specialist from a need — only tools the owner may give, never a half-valid draft", async () => {
    const a = await import("@/app/actions/specialists");
    expect(await a.proposeSpecialistDraft("x", "fr")).toEqual({ ok: false, code: "invalid" });

    // Without Supabase or email here, sending email is not something the owner can give; research never is.
    h.answer.current = JSON.stringify({ name: "Juriste", description: "Lit mes contrats.", instructions: "Tu lis les contrats et cites la loi.", tools: ["web_search", "email_send", "research"], depth: "deep" });
    const r = await a.proposeSpecialistDraft("Quelqu'un qui lit mes contrats", "fr");
    expect(r).toEqual({ ok: true, data: { name: "Juriste", description: "Lit mes contrats.", instructions: "Tu lis les contrats et cites la loi.", tools: ["web_search"], depth: "deep" } });

    h.answer.current = '{"name": "", "tools": []}';
    expect(await a.proposeSpecialistDraft("Quelqu'un qui lit mes contrats", "fr")).toEqual({ ok: false, code: "unusable" });

    const { AIError } = await import("@/lib/ai/router");
    h.answer.current = new AIError("rate_limit", "slow down");
    expect(await a.proposeSpecialistDraft("Quelqu'un qui lit mes contrats", "fr")).toEqual({ ok: false, code: "rate_limit" });
  });
});

describe("a specialist the agent creates", () => {
  it("passes the same checks, and says how to reach it", async () => {
    const { createSpecialistFor } = await import("@/lib/specialists/agent");
    const ok = await createSpecialistFor("ada@x.test", input("Comptable"));
    expect(ok).toMatchObject({ ok: true, detail: 'Created the specialist "Comptable".' });
    expect((ok as { data: string }).data).toMatch(/^Specialist created \[[0-9a-f-]{36}\]/);
    expect(await createSpecialistFor("ada@x.test", input("comptable"))).toMatchObject({ ok: false, error: expect.stringContaining("already has that name") });
    expect(await createSpecialistFor("ada@x.test", { ...input("Autre"), tools: ["delegate"] })).toMatchObject({ ok: false, error: expect.stringContaining("tools") });
  });
});
