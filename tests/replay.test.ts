import { describe, it, expect } from "vitest";
import { beatFor, replayEvents, visibleAt } from "@/lib/brain/replay";
import type { NoteLike } from "@/lib/brain/graph";

const note = (id: string, at: string): NoteLike => ({ id, category: "ideas", title: id, detail: null, done: false, createdAt: at });

describe("the brain's history", () => {
  const notes = [note("b", "2026-09-02T10:00:00Z"), note("a", "2026-09-01T10:00:00Z"), note("c", "2026-09-03T10:00:00Z")];

  it("plays notes in the order they were written, and a connection when it was drawn", () => {
    const events = replayEvents(notes, [{ id: "ab", fromId: "a", toId: "b", createdAt: "2026-09-02T12:00:00Z" }]);
    expect(events.map((e) => e.id)).toEqual(["a", "b", "ab", "c"]);
  });

  it("never shows a connection before both its notes", () => {
    // Dated before its second note (clock skew, imported data), or not dated at all.
    const events = replayEvents(notes, [
      { id: "ac", fromId: "a", toId: "c", createdAt: "2026-08-01T00:00:00Z" },
      { id: "bc", fromId: "b", toId: "c" },
    ]);
    const order = events.map((e) => e.id);
    expect(order.indexOf("ac")).toBeGreaterThan(order.indexOf("c"));
    expect(order.indexOf("bc")).toBeGreaterThan(order.indexOf("c"));
  });

  it("drops connections to notes that no longer exist", () => {
    expect(replayEvents(notes, [{ id: "ax", fromId: "a", toId: "x" }]).some((e) => e.id === "ax")).toBe(false);
  });

  it("is deterministic when everything happened at once", () => {
    const burst = ["n3", "n1", "n2"].map((id) => note(id, "2026-09-01T10:00:00Z"));
    const links = [{ id: "l1", fromId: "n1", toId: "n2" }];
    const once = replayEvents(burst, links).map((e) => e.id);
    expect(once).toEqual(["n1", "n2", "n3", "l1"]);
    expect(replayEvents([...burst].reverse(), links).map((e) => e.id)).toEqual(once);
  });

  it("says what is visible after each beat", () => {
    const events = replayEvents(notes, [{ id: "ab", fromId: "a", toId: "b", createdAt: "2026-09-02T12:00:00Z" }]);
    expect(visibleAt(events, 0)).toEqual({ notes: new Set(), links: new Set(), at: null });
    const three = visibleAt(events, 3);
    expect([...three.notes]).toEqual(["a", "b"]);
    expect([...three.links]).toEqual(["ab"]);
    expect(three.at).toBe("2026-09-02T12:00:00Z");
    expect(visibleAt(events, 99).notes.size).toBe(3);
  });

  it("paces a replay to about ten seconds, within bounds", () => {
    expect(beatFor(0)).toBe(0);
    expect(beatFor(10)).toBe(400);
    expect(beatFor(100)).toBe(100);
    expect(beatFor(10_000)).toBe(35);
  });
});
