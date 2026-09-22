import { describe, it, expect } from "vitest";
import { selectBlueprints } from "@/lib/notion/blueprint";

const keysFor = (...areas: Parameters<typeof selectBlueprints>[0]) => selectBlueprints(areas).map((b) => b.key);

describe("Notion export: which databases to build", () => {
  it("always includes the core databases", () => {
    const keys = keysFor();
    for (const core of ["projects", "tasks", "goals", "weeklyPlanner", "habits", "journal"]) {
      expect(keys).toContain(core);
    }
  });

  it("adds one module per area the person chose", () => {
    expect(keysFor("clients")).toContain("crm");
    expect(keysFor("money")).toContain("finance");
    expect(keysFor("learning")).toEqual(expect.arrayContaining(["knowledge", "reading"]));
    expect(keysFor("team")).toContain("meetings");
  });

  it("adds nothing the person did not ask for", () => {
    const keys = keysFor("health", "personal");
    for (const optional of ["crm", "finance", "knowledge", "reading", "meetings"]) {
      expect(keys).not.toContain(optional);
    }
  });

  it("returns valid blueprints, each with a title property", () => {
    for (const bp of selectBlueprints(["clients", "money", "learning", "team"])) {
      expect(Object.values(bp.properties).some((p) => "title" in p)).toBe(true);
    }
  });

  it("is deterministic, so the list shown before a build is what gets built", () => {
    expect(keysFor("team", "clients")).toEqual(keysFor("team", "clients"));
  });
});
