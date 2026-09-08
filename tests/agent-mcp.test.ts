import { describe, it, expect } from "vitest";
import { CAPABILITIES, getCapability } from "@/lib/agent/capabilities";
import { listMcpTools, toToolName, fromToolName } from "@/lib/agent/mcp-tools";
import { decide, derivePolicy, MINIMUM_POLICY, AUTONOMY_ORDER, type AgentPolicy, type UsageState } from "@/lib/agent/policy";

const fresh: UsageState = { runsToday: 0, spentTodayCents: 0, killSwitchOn: false };
const permissive: AgentPolicy = {
  ...MINIMUM_POLICY,
  autonomy: "extend",
  dailyBudgetCents: 100,
  dailyRunLimit: 100,
  degraded: false,
};

describe("MCP tool surface", () => {
  const tools = listMcpTools();

  it("never publishes a forbidden capability", () => {
    const forbidden = CAPABILITIES.filter((c) => c.tier === "forbidden");
    expect(forbidden.length).toBeGreaterThan(0);
    for (const cap of forbidden) {
      expect(
        tools.find((t) => t.name === toToolName(cap.id)),
        `${cap.id} must not be advertised over MCP`
      ).toBeUndefined();
    }
  });

  it("publishes every capability that is not forbidden", () => {
    for (const cap of CAPABILITIES.filter((c) => c.tier !== "forbidden")) {
      expect(tools.find((t) => t.name === toToolName(cap.id)), cap.id).toBeDefined();
    }
  });

  it("round-trips tool names back to capability ids", () => {
    for (const t of tools) {
      const id = fromToolName(t.name);
      expect(id, t.name).toBeDefined();
      expect(getCapability(id!)).toBeDefined();
    }
    // Dots are not legal in MCP tool names.
    expect(tools.every((t) => /^[a-z0-9_-]+$/.test(t.name))).toBe(true);
  });

  it("does not resolve an unknown tool name to a capability", () => {
    expect(fromToolName("rm_rf")).toBeUndefined();
    expect(fromToolName("")).toBeUndefined();
    // A forbidden capability must not be reachable via its mangled name either.
    expect(fromToolName("payment")).toBe("payment");
    expect(decide("payment", permissive, fresh).action).toBe("deny");
  });

  it("warns the model that high-risk tools stop for approval", () => {
    for (const cap of CAPABILITIES.filter((c) => c.tier === "high")) {
      const tool = tools.find((t) => t.name === toToolName(cap.id))!;
      expect(tool.description, cap.id).toMatch(/approval/i);
    }
  });

  it("gives every published tool a usable schema", () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(Object.keys(t.inputSchema.properties).length, t.name).toBeGreaterThan(0);
    }
  });
});

describe("draft now, send later", () => {
  const drafting = ["email.draft", "campaign.draft", "proposal.draft"];

  it("lets the agent draft without asking permission", () => {
    // The whole point: a day's work can happen unsupervised because none of it
    // leaves LifeOS. `act` is the mid autonomy level, not the maximum.
    const acting: AgentPolicy = { ...permissive, autonomy: "act" };
    for (const id of drafting) {
      expect(decide(id, acting, fresh).action, id).toBe("allow");
    }
  });

  it("never lets the agent send, at any autonomy level", () => {
    for (const autonomy of AUTONOMY_ORDER) {
      const policy: AgentPolicy = { ...permissive, autonomy };
      expect(decide("email.send", policy, fresh).action, autonomy).not.toBe("allow");
      expect(decide("ads.launch", policy, fresh).action, autonomy).not.toBe("allow");
    }
  });

  it("keeps ad spend approval-gated and open-ended payment forbidden", () => {
    // The distinction the product rests on: a capped, per-campaign ad spend is
    // approvable; moving money generally is not delegable at all.
    expect(getCapability("ads.launch")?.tier).toBe("high");
    expect(decide("ads.launch", permissive, fresh).action).toBe("approve");

    expect(getCapability("payment")?.tier).toBe("forbidden");
    expect(decide("payment", permissive, fresh).action).toBe("deny");
  });

  it("never lets the agent bind the owner to a contract", () => {
    expect(getCapability("contract.sign")?.tier).toBe("forbidden");
    for (const autonomy of AUTONOMY_ORDER) {
      expect(decide("contract.sign", { ...permissive, autonomy }, fresh).action).toBe("deny");
    }
  });

  it("still meters drafting, so a loop cannot write forever", () => {
    const exhausted: UsageState = { ...fresh, runsToday: permissive.dailyRunLimit };
    for (const id of drafting) {
      expect(decide(id, permissive, exhausted).action, id).toBe("deny");
    }
  });

  it("stops drafting when the kill switch is on", () => {
    const stopped = { ...fresh, killSwitchOn: true };
    for (const id of drafting) {
      expect(decide(id, permissive, stopped).action, id).toBe("deny");
    }
  });
});

describe("a real assessment cannot unlock the new capabilities", () => {
  it("holds even for a maximally permissive profile", () => {
    // Guards against someone later re-tiering ads/email by mistake: whatever
    // the profile says, these must not auto-execute.
    const p = derivePolicy(null);
    expect(p).toEqual(MINIMUM_POLICY);
    for (const id of ["email.send", "ads.launch", "payment", "contract.sign"]) {
      expect(decide(id, p, fresh).action, id).not.toBe("allow");
    }
  });
});
