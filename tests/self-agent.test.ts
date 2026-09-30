import { describe, expect, it } from "vitest";
import { getCapability } from "@/lib/agent/capabilities";
import { listMcpTools } from "@/lib/agent/mcp-tools";
import { MINIMUM_POLICY, decide, isMetered, type UsageState } from "@/lib/agent/policy";
import { adviceLine, selfBrief } from "@/lib/self/agent-view";
import { portraitOf, traitKey, type TraitLike } from "@/lib/self/portrait";
import type { Advice } from "@/lib/self/advice";

const fresh: UsageState = { runsToday: 0, spentTodayCents: 0, killSwitchOn: false };

describe("the agent reads the double", () => {
  it("as a safe read: published, allowed at the lowest autonomy, never drawing on the quota", () => {
    const cap = getCapability("self.read");
    expect(cap?.tier).toBe("safe");
    expect(isMetered("safe")).toBe(false);
    expect(decide("self.read", MINIMUM_POLICY, fresh).action).toBe("allow");
    const tool = listMcpTools().find((t) => t.name === "self_read");
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["section"]);
    expect(tool?.inputSchema.required).toBeUndefined();
  });

  it("but not through the kill switch", () => {
    expect(decide("self.read", MINIMUM_POLICY, { ...fresh, killSwitchOn: true }).action).toBe("deny");
  });

  it("gives it the advice as lines it can act on, with the moment in their time zone, and no time nobody said", () => {
    const a = (over: Partial<Advice>): Advice => ({ key: "k", kind: "commitment", priority: 1, noteIds: [], facts: {}, actions: [], ...over });
    expect(adviceLine(a({ facts: { title: "Appeler Marc vendredi", at: "2026-10-02T07:00:00.000Z", timed: 0 } }), "Europe/Paris")).toBe(
      '- Next step "Appeler Marc vendredi" names Friday 2 October (Europe/Paris) and nothing will remind them: offer to set a reminder.'
    );
    expect(adviceLine(a({ facts: { title: "Appeler Anna à 15h", at: "2026-10-02T13:00:00.000Z", timed: 1 } }), "Europe/Paris")).toContain("Friday 2 October at 15:00");
    expect(adviceLine(a({ kind: "energy-low", facts: { mean: 2, n: 3 } }), "UTC")).toContain("Not a diagnosis");
  });

  it("puts the portrait, the suggestions and the day's question together — and says when there is nothing", () => {
    const t: TraitLike = {
      id: "t",
      dimension: "values",
      statement: "Vous privilégiez la qualité",
      evidence: [{ noteId: "n", quote: "la qualité compte plus" }],
      status: "confirmed",
      origin: "ai",
      key: traitKey("Vous privilégiez la qualité"),
      createdAt: "2026-09-30",
      updatedAt: "2026-09-30",
    };
    const text = selfBrief({
      portrait: portraitOf([t], [{ id: "n", title: "La qualité compte plus que le prix", detail: null }]),
      rhythm: null,
      advice: [],
      question: "What matters most to you in your life right now?",
      zone: "UTC",
    });
    expect(text).toContain("confirmed by them\n- (what matters to them) Vous privilégiez la qualité");
    expect(text).toContain("(nothing at the moment)");
    expect(text).toContain("## Today's question for them\nWhat matters most to you in your life right now?");
    expect(text).not.toContain("check-ins");
  });

  it("reads one part only when asked", () => {
    const brief = (only?: "portrait" | "checkins" | "advice" | "question") =>
      selfBrief({ portrait: portraitOf([], []), rhythm: null, advice: [], question: null, zone: "UTC", only });
    expect(brief("advice")).toBe("## What their double would raise now\n(nothing at the moment)");
    expect(brief("checkins")).toBe("## Their check-ins\n(none yet)");
    expect(brief("question")).toBe("## Today's question for them\n(they have answered every question)");
    expect(brief()).not.toContain("check-ins");
  });
});
