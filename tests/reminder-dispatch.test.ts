import { describe, it, expect } from "vitest";
import { dispatchDue, reminderMessage, type DispatchDeps, type DueReminder } from "@/lib/reminders/dispatch";

const due = (id: string, userKey = "u1", repeat = "none"): DueReminder => ({
  id,
  userKey,
  title: `Rappel ${id}`,
  dueAt: "2026-09-28T07:00:00.000Z",
  repeat,
});

/** A fake database: `told` is the notified_at column, `claim` the conditional update. */
function world(rows: DueReminder[], chats: Record<string, string | null>, sendOk = true) {
  const told = new Set<string>();
  const sent: { chat: string; text: string }[] = [];
  let chatLookups = 0;
  const deps: DispatchDeps = {
    due: async () => rows.filter((r) => !told.has(r.id)),
    claim: async (id) => {
      // Yield first, like a real round-trip, so concurrent runs interleave.
      await new Promise((r) => setTimeout(r, 0));
      if (told.has(id)) return false;
      told.add(id);
      return true;
    },
    release: async (id) => {
      told.delete(id);
    },
    chatOf: async (u) => {
      chatLookups++;
      return chats[u] ?? null;
    },
    send: async (chat, text) => {
      if (!sendOk) return false;
      sent.push({ chat, text });
      return true;
    },
  };
  return { deps, told, sent, lookups: () => chatLookups };
}

describe("sending due reminders on Telegram", () => {
  it("sends each due reminder to its owner's chat, once", async () => {
    const w = world([due("a"), due("b", "u2")], { u1: "chat-1", u2: "chat-2" });
    const report = await dispatchDue(w.deps);
    expect(report).toEqual({ checked: 2, sent: 2, failed: 0, noChannel: 0 });
    expect(w.sent).toEqual([
      { chat: "chat-1", text: "⏰ Rappel a" },
      { chat: "chat-2", text: "⏰ Rappel b" },
    ]);
    // A second run finds nothing left to say.
    expect((await dispatchDue(w.deps)).sent).toBe(0);
  });

  it("never sends twice when two runs race", async () => {
    const w = world([due("a"), due("b"), due("c")], { u1: "chat-1" });
    const [one, two] = await Promise.all([dispatchDue(w.deps), dispatchDue(w.deps)]);
    expect(one.sent + two.sent).toBe(3);
    expect(w.sent.map((s) => s.text).sort()).toEqual(["⏰ Rappel a", "⏰ Rappel b", "⏰ Rappel c"]);
  });

  it("gives the claim back when the send fails, so the next run retries", async () => {
    const w = world([due("a")], { u1: "chat-1" }, false);
    const report = await dispatchDue(w.deps);
    expect(report).toMatchObject({ sent: 0, failed: 1 });
    expect(w.told.has("a")).toBe(false);
  });

  it("leaves a reminder alone when its owner linked no chat — the app will tell them", async () => {
    const w = world([due("a"), due("b")], { u1: null });
    const report = await dispatchDue(w.deps);
    expect(report).toEqual({ checked: 2, sent: 0, failed: 0, noChannel: 2 });
    expect(w.told.size).toBe(0);
    // One lookup per person, not per reminder.
    expect(w.lookups()).toBe(1);
  });

  it("marks a repeating reminder and bounds the title", () => {
    expect(reminderMessage({ title: "Stand-up", repeat: "weekdays" })).toBe("⏰ Stand-up  🔁");
    expect(reminderMessage({ title: "x".repeat(500), repeat: "none" }).length).toBe(302);
  });
});
