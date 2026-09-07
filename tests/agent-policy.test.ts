import { describe, it, expect } from "vitest";
import { CAPABILITIES, getCapability } from "@/lib/agent/capabilities";
import { decide, derivePolicy, MINIMUM_POLICY, AUTONOMY_ORDER, type AgentPolicy, type UsageState } from "@/lib/agent/policy";
import { scoreAssessment, reverseScore, isStraightLined } from "@/lib/assessment/scoring";
import { items, ATTENTION_CHECK, ATTENTION_CHECK_EXPECTED, LIKERT_MIN, LIKERT_MAX } from "@/lib/assessment/instrument";

const fresh: UsageState = { runsToday: 0, spentTodayCents: 0, killSwitchOn: false };

/** A maximally permissive profile: every calibration item answered "very accurate". */
function maxAutonomyResponses() {
  const r: Record<string, number> = {};
  for (const i of items) {
    // Answer so that every trait/axis reads high after reverse-keying.
    r[i.id] = i.reverse ? LIKERT_MIN : LIKERT_MAX;
  }
  r[ATTENTION_CHECK.id] = ATTENTION_CHECK_EXPECTED;
  // Keep neuroticism low so it doesn't damp autonomy.
  for (const i of items.filter((x) => x.facet === "N")) {
    r[i.id] = i.reverse ? LIKERT_MAX : LIKERT_MIN;
  }
  return r;
}

describe("assessment scoring", () => {
  it("reverses Likert values symmetrically", () => {
    expect(reverseScore(1)).toBe(5);
    expect(reverseScore(5)).toBe(1);
    expect(reverseScore(3)).toBe(3);
  });

  it("detects straight-lining", () => {
    const same = Object.fromEntries(items.map((i) => [i.id, 4]));
    expect(isStraightLined(same)).toBe(true);
    const varied = Object.fromEntries(items.map((i, n) => [i.id, (n % 5) + 1]));
    expect(isStraightLined(varied)).toBe(false);
  });

  it("flags a failed attention check", () => {
    const r = maxAutonomyResponses();
    r[ATTENTION_CHECK.id] = 5; // expected 2
    expect(scoreAssessment(r).flags.inattentive).toBe(true);
    expect(scoreAssessment(r).valid).toBe(false);
  });

  it("flags an incomplete assessment", () => {
    const r = { [items[0].id]: 4 };
    const out = scoreAssessment(r);
    expect(out.flags.incomplete).toBe(true);
    expect(out.valid).toBe(false);
  });

  it("keeps every score inside the Likert range", () => {
    const out = scoreAssessment(maxAutonomyResponses());
    for (const v of [...Object.values(out.domains), ...Object.values(out.calibration)]) {
      expect(v).toBeGreaterThanOrEqual(LIKERT_MIN);
      expect(v).toBeLessThanOrEqual(LIKERT_MAX);
    }
  });
});

describe("policy derivation", () => {
  it("falls back to the minimum policy without an assessment", () => {
    const p = derivePolicy(null);
    expect(p.autonomy).toBe("observe");
    expect(p.dailyBudgetCents).toBe(0);
    expect(p.degraded).toBe(true);
  });

  it("refuses to trust an invalid assessment", () => {
    const straight = Object.fromEntries(items.map((i) => [i.id, 5]));
    const p = derivePolicy(scoreAssessment(straight));
    expect(p).toEqual(MINIMUM_POLICY);
  });

  it("never exceeds the highest defined autonomy level", () => {
    const p = derivePolicy(scoreAssessment(maxAutonomyResponses()));
    expect(AUTONOMY_ORDER).toContain(p.autonomy);
    expect(AUTONOMY_ORDER.indexOf(p.autonomy)).toBeLessThanOrEqual(
      AUTONOMY_ORDER.indexOf("extend")
    );
  });

  it("explains itself", () => {
    const p = derivePolicy(scoreAssessment(maxAutonomyResponses()));
    expect(p.reasons.length).toBeGreaterThan(0);
  });
});

describe("guardrails — the assessment can never unlock danger", () => {
  const permissive = derivePolicy(scoreAssessment(maxAutonomyResponses()));

  it("denies every forbidden capability at maximum autonomy", () => {
    for (const cap of CAPABILITIES.filter((c) => c.tier === "forbidden")) {
      const d = decide(cap.id, permissive, fresh);
      expect(d.action, `${cap.id} must be denied`).toBe("deny");
    }
  });

  it("requires approval for every high-risk capability at maximum autonomy", () => {
    for (const cap of CAPABILITIES.filter((c) => c.tier === "high")) {
      const d = decide(cap.id, permissive, fresh);
      expect(d.action, `${cap.id} must need approval`).toBe("approve");
    }
  });

  it("never auto-allows anything above the medium tier, at any level", () => {
    for (const autonomy of AUTONOMY_ORDER) {
      const policy: AgentPolicy = { ...permissive, autonomy };
      for (const cap of CAPABILITIES) {
        const d = decide(cap.id, policy, fresh);
        if (d.action === "allow") {
          expect(["safe", "low", "medium"]).toContain(cap.tier);
        }
      }
    }
  });

  it("default-denies unknown capabilities", () => {
    expect(decide("definitely.not.a.capability", permissive, fresh).action).toBe("deny");
    expect(decide("", permissive, fresh).action).toBe("deny");
  });

  it("the kill switch overrides everything, including safe reads", () => {
    const stopped = { ...fresh, killSwitchOn: true };
    for (const cap of CAPABILITIES) {
      expect(decide(cap.id, permissive, stopped).action).toBe("deny");
    }
  });

  it("stops at the daily run limit", () => {
    const spent = { ...fresh, runsToday: permissive.dailyRunLimit };
    expect(decide("brain.read", permissive, spent).action).toBe("deny");
  });

  it("stops at the daily budget", () => {
    const broke = { ...fresh, spentTodayCents: permissive.dailyBudgetCents };
    expect(decide("brain.read", permissive, broke).action).toBe("deny");
  });

  it("observe-level executes nothing that writes", () => {
    const observer: AgentPolicy = { ...permissive, autonomy: "observe" };
    for (const cap of CAPABILITIES.filter((c) => c.tier === "low" || c.tier === "medium")) {
      expect(decide(cap.id, observer, fresh).action).not.toBe("allow");
    }
  });
});

describe("capability catalogue integrity", () => {
  it("has unique ids", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is fully bilingual and justified", () => {
    for (const c of CAPABILITIES) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(c.labelFr.length, c.id).toBeGreaterThan(0);
      expect(c.rationale.length, c.id).toBeGreaterThan(0);
      expect(getCapability(c.id)).toBe(c);
    }
  });

  it("keeps money, secrets, deletion and account changes forbidden", () => {
    for (const id of ["payment", "credentials.read", "data.delete", "account.modify"]) {
      expect(getCapability(id)?.tier, id).toBe("forbidden");
    }
  });
});
