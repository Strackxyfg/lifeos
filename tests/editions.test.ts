import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  EDITIONS,
  FEATURES,
  HOME,
  LIMITS,
  NAV_FEATURE,
  addedBy,
  editionFor,
  editionOfPlan,
  featuresOf,
  includes,
  isEdition,
  resolveEdition,
  suggestEdition,
  type Edition,
} from "@/lib/plans/editions";
import { readProfileAnswers, onboardingSchema } from "@/lib/onboarding";
import { primaryNav, secondaryNav, workNav } from "@/lib/content/app-nav";
import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * The three editions: which feature each opens, which one a person uses,
 * and that the server — not only the navigation — says no.
 */

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// What the stored profile and the subscription row say, per test.
const h = vi.hoisted(() => ({
  profile: { current: null as { answers: Record<string, unknown> } | null },
  sub: { current: null as { plan: string; status: string } | null },
}));
vi.mock("@/lib/user/profile", () => ({ loadStoredProfile: async () => h.profile.current }));
vi.mock("@/lib/supabase/rls", () => ({
  getSupabaseUser: async () => ({ id: "u1" }),
  createRlsClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.sub.current, error: null }) }) }) }),
  }),
}));

describe("the feature matrix", () => {
  it("gives every feature exactly one home edition", () => {
    for (const f of FEATURES) expect(EDITIONS).toContain(HOME[f]);
    expect(Object.keys(HOME).sort()).toEqual([...FEATURES].sort());
  });

  it("nests the editions: each contains the one before it", () => {
    const [personal, solo, team] = EDITIONS.map(featuresOf);
    expect(personal.every((f) => solo.includes(f))).toBe(true);
    expect(solo.every((f) => team.includes(f))).toBe(true);
    expect(team).toEqual([...FEATURES]);
    expect(personal.length).toBeLessThan(solo.length);
    expect(solo.length).toBeLessThan(team.length);
  });

  it("splits the features between the editions without overlap", () => {
    const added = EDITIONS.flatMap(addedBy);
    expect(added.sort()).toEqual([...FEATURES].sort());
  });

  it("puts the life in Personal, the business in Solo, the company in Team", () => {
    for (const f of ["brain", "double", "maps", "voice", "reminders", "hub", "assistant", "agent", "circles"] as const) {
      expect(editionFor(f), f).toBe("personal");
    }
    for (const f of ["projects", "crm", "finance", "review", "reports", "notion", "agent.runner"] as const) {
      expect(editionFor(f), f).toBe("solo");
    }
    for (const f of ["teams", "enterprise"] as const) expect(editionFor(f), f).toBe("team");
    expect(includes("personal", "crm")).toBe(false);
    expect(includes("solo", "crm")).toBe(true);
    expect(includes("solo", "enterprise")).toBe(false);
    expect(includes("team", "enterprise")).toBe(true);
  });

  it("bounds the agent more loosely as the edition grows", () => {
    expect(LIMITS.personal.agentRunsPerDay).toBeLessThan(LIMITS.solo.agentRunsPerDay);
    expect(LIMITS.solo.agentRunsPerDay).toBeLessThan(LIMITS.team.agentRunsPerDay);
    for (const e of EDITIONS) expect(LIMITS[e].agentSteps).toBeGreaterThanOrEqual(4);
  });
});

describe("the edition in use", () => {
  it("during early access: the one chosen, and the full one for whoever never chose", () => {
    expect(resolveEdition(null, null, false)).toBe("team");
    for (const e of EDITIONS) expect(resolveEdition(e, null, false)).toBe(e);
    // A subscription changes nothing while billing is off.
    expect(resolveEdition("personal", "team", false)).toBe("personal");
  });

  it("once billing decides, never more than what is paid for", () => {
    expect(resolveEdition(null, null, true)).toBe("personal");
    expect(resolveEdition("team", null, true)).toBe("personal");
    expect(resolveEdition("team", "solo", true)).toBe("solo");
    expect(resolveEdition("personal", "team", true)).toBe("personal");
    expect(resolveEdition(null, "solo", true)).toBe("solo");
  });

  it("reads plans, old names included, and refuses the unknown", () => {
    expect(editionOfPlan("solo")).toBe("solo");
    expect(editionOfPlan("starter")).toBe("personal");
    expect(editionOfPlan("pro")).toBe("solo");
    expect(editionOfPlan("founder")).toBe("team");
    expect(editionOfPlan("platinum")).toBeNull();
    expect(editionOfPlan(undefined)).toBeNull();
    expect(isEdition("team")).toBe(true);
    expect(isEdition("Team")).toBe(false);
  });

  it("suggests one from the parts of life chosen at onboarding", () => {
    expect(suggestEdition([])).toBe("personal");
    expect(suggestEdition(["health", "learning"])).toBe("personal");
    expect(suggestEdition(["clients"])).toBe("solo");
    expect(suggestEdition(["money", "personal"])).toBe("solo");
    expect(suggestEdition(["projects", "team"])).toBe("team");
  });

  it("keeps a stored edition only when it is one", () => {
    expect(readProfileAnswers({ areas: ["health"], edition: "solo" })).toEqual({ areas: ["health"], edition: "solo" });
    expect(readProfileAnswers({ areas: ["health"], edition: "gold" })).toEqual({ areas: ["health"] });
    expect(readProfileAnswers({ areas: ["nope", "money"], edition: "team" })).toEqual({ areas: ["money"], edition: "team" });
    expect(readProfileAnswers(null)).toEqual({ areas: [] });
  });

  it("takes the edition at onboarding, and older clients without one", () => {
    const base = { name: "Camille", profession: "Founder", goal: "Ship" };
    expect(onboardingSchema.parse({ ...base, edition: "solo" }).edition).toBe("solo");
    expect(onboardingSchema.parse(base).edition).toBeUndefined();
    expect(onboardingSchema.safeParse({ ...base, edition: "gold" }).success).toBe(false);
  });
});

describe("the server's word", () => {
  const { profile, sub } = h;
  const saved: Record<string, string | undefined> = {};
  const ENV = ["BILLING_ENFORCED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    profile.current = null;
    sub.current = null;
    vi.resetModules();
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const state = async () => (await import("@/lib/plans/server")).getEditionState();

  it("opens everything to an account from before the editions", async () => {
    delete process.env.BILLING_ENFORCED;
    expect(await state()).toEqual({ edition: "team", chosen: null, entitled: null, billing: false });
  });

  it("follows the choice during early access", async () => {
    delete process.env.BILLING_ENFORCED;
    profile.current = { answers: { areas: [], edition: "personal" } };
    const s = await import("@/lib/plans/server");
    expect(await s.getEdition()).toBe("personal");
    expect(await s.locked("crm")).toBe("solo");
    expect(await s.locked("brain")).toBeNull();
    const refusal = await s.featureRefusal("notion");
    expect(refusal?.status).toBe(403);
    expect(await refusal?.json()).toEqual({ error: "edition", feature: "notion", needed: "solo" });
    expect(await s.featureRefusal("maps")).toBeNull();
  });

  it("enforces billing only with Supabase, and caps by the paid subscription", async () => {
    process.env.BILLING_ENFORCED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    profile.current = { answers: { edition: "team" } };
    expect((await state()).billing).toBe(false);

    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
    sub.current = { plan: "pro", status: "active" };
    expect(await state()).toEqual({ edition: "solo", chosen: "team", entitled: "solo", billing: true });

    vi.resetModules();
    sub.current = { plan: "team", status: "canceled" };
    expect((await state()).edition).toBe("personal");
  });
});

describe("where the editions are enforced", () => {
  it("names a feature for every entry of the navigation but the account", () => {
    for (const item of [...primaryNav, ...workNav]) expect(NAV_FEATURE[item.id], item.id).toBeDefined();
    for (const item of secondaryNav) expect(NAV_FEATURE[item.id], item.id).toBeUndefined();
  });

  it("gates every page of a Solo feature on the server", () => {
    for (const [dir, feature] of [
      ["projects", "projects"],
      ["crm", "crm"],
      ["finance", "finance"],
      ["review", "review"],
      ["reports", "reports"],
    ] as const) {
      const path = `app/(app)/${dir}/layout.tsx`;
      expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(read(path)).toContain(`<EditionGate feature="${feature}">`);
    }
  });

  it("checks the edition in every action that writes an edition's data", () => {
    const expectations: [string, string[]][] = [
      ["app/actions/workspace.ts", ['outside("projects")', 'outside("crm")', 'outside("finance")']],
      ["app/actions/founder.ts", ['ready("finance")', 'ready("crm")', 'ready("review")']],
      ["app/actions/enterprise.ts", ['locked("enterprise")']],
      ["app/actions/team.ts", ['locked("teams")']],
      ["app/actions/agent.ts", ['locked("agent.runner")']],
      ["app/api/generate/stream/route.ts", ['featureRefusal("notion")']],
      ["app/api/integrations/notion/authorize/route.ts", ['locked("notion")']],
    ];
    for (const [file, needles] of expectations) {
      const src = read(file);
      for (const n of needles) expect(src, `${file} → ${n}`).toContain(n);
    }
    // Every founder write goes through `ready(feature)`: none left without one.
    expect(read("app/actions/founder.ts")).not.toContain("await ready()");
    // The two runner credentials are checked where they are issued.
    expect(read("app/actions/agent.ts").match(/await runnerAllowed\(\)/g)?.length).toBe(2);
  });

  it("lets only the webhook write what is paid for", () => {
    const webhook = read("app/api/stripe/webhook/route.ts");
    expect(webhook).toContain("editionOfPlan(");
    expect(webhook).not.toMatch(/\?\? "pro"/);
    expect(read("lib/stripe/client.ts")).toContain("metadata: { plan: opts.plan }");
  });
});

describe("the words", () => {
  for (const locale of ["en", "fr"] as const) {
    const m = dictionaries[locale];

    it(`${locale}: names every edition and every feature`, () => {
      for (const e of EDITIONS) expect(m.editions.names[e], e).toBeTruthy();
      for (const f of FEATURES) expect(m.editions.features[f], f).toBeTruthy();
      for (const code of ["unauthorized", "invalid", "payment_required", "failed"] as const) expect(m.editions.errors[code]).toBeTruthy();
      expect(m.founder.errors.edition).toBeTruthy();
      expect(m.team.errors.edition).toBeTruthy();
      expect(m.team.enterprise.errors.edition).toBeTruthy();
      expect(m.notion.edition).toBeTruthy();
      expect(m.nav.circles).toBeTruthy();
    });

    it(`${locale}: prices the editions in order, with no number for Team until it is decided`, () => {
      const plans = m.pricing.plans;
      expect(plans.map((p) => p.id)).toEqual([...EDITIONS]);
      const price: Record<Edition, number | null> = Object.fromEntries(plans.map((p) => [p.id, p.price])) as never;
      expect(price.personal).toBe(19);
      expect(price.solo).toBe(49);
      expect(price.team).toBeNull();
      for (const p of plans) {
        expect(p.name).toBe(m.editions.names[p.id as Edition]);
        expect(p.features.length).toBeGreaterThanOrEqual(4);
      }
    });
  }

  it("keeps the same plan shapes in both languages", () => {
    const shape = (l: "en" | "fr") => dictionaries[l].pricing.plans.map((p) => [p.id, p.price, p.features.length, "featured" in p]);
    expect(shape("fr")).toEqual(shape("en"));
  });
});
