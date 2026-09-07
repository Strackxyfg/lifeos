import "server-only";
import { getStore } from "@/lib/db/store";
import { getCapability } from "./capabilities";

/**
 * Performs an approved capability — **inside LifeOS, never in the runner**.
 *
 * The runner only ever proposes. Keeping execution here means a compromised
 * runner can do nothing on its own: it has no database, no Notion token, and
 * no code path that writes anything.
 *
 * Capabilities we haven't built yet return `not_implemented` rather than
 * silently succeeding — the agent must never be able to claim it sent an email
 * that was never sent.
 */
export type ExecuteResult =
  | { ok: true; detail: string }
  | { ok: false; error: string; code: "not_implemented" | "invalid_payload" | "failed" };

export async function executeCapability(
  userKey: string,
  capabilityId: string,
  payload: Record<string, unknown> = {}
): Promise<ExecuteResult> {
  const cap = getCapability(capabilityId);
  if (!cap) return { ok: false, error: `Unknown capability "${capabilityId}".`, code: "failed" };

  const store = getStore();
  const str = (v: unknown, max = 500) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

  try {
    switch (capabilityId) {
      // Reads have no effect to perform; the runner already got the data.
      case "brain.read":
      case "workspace.read":
      case "analyze":
        return { ok: true, detail: "Read granted." };

      case "brain.write": {
        const title = str(payload.title);
        if (!title) return { ok: false, error: "A note needs a title.", code: "invalid_payload" };
        const category = ["ideas", "thoughts", "next", "knowledge", "insights"].includes(
          String(payload.category)
        )
          ? (payload.category as string)
          : "thoughts";
        const kindByCategory: Record<string, string> = {
          ideas: "idea", thoughts: "thought", next: "task",
          knowledge: "note", insights: "insight",
        };
        await store.insert(userKey, "brain", {
          category: category as never,
          kind: kindByCategory[category] as never,
          seedKey: null,
          title,
          detail: str(payload.detail),
          done: false,
          ai: true,
        });
        return { ok: true, detail: `Captured "${title.slice(0, 60)}" under ${category}.` };
      }

      case "task.write": {
        const label = str(payload.label ?? payload.title, 200);
        if (!label) return { ok: false, error: "A task needs a label.", code: "invalid_payload" };
        await store.insert(userKey, "tasks", { labelKey: null, label, done: false });
        return { ok: true, detail: `Added task "${label.slice(0, 60)}".` };
      }

      case "project.write": {
        const name = str(payload.name ?? payload.title, 120);
        if (!name) return { ok: false, error: "A project needs a name.", code: "invalid_payload" };
        const status = ["Planning", "In progress", "Blocked", "Done"].includes(String(payload.status))
          ? (payload.status as string)
          : "Planning";
        await store.insert(userKey, "projects", {
          name,
          status: status as never,
          owner: str(payload.owner, 60) ?? "Agent",
          due: str(payload.due, 40) ?? "",
          progress: 0,
          priority: "Medium",
        });
        return { ok: true, detail: `Created project "${name.slice(0, 60)}".` };
      }

      // Deliberately unbuilt. Better an honest refusal than a false success.
      default:
        return {
          ok: false,
          code: "not_implemented",
          error: `${cap.label} is approved by policy but not yet wired up — nothing was done.`,
        };
    }
  } catch (err) {
    return {
      ok: false,
      code: "failed",
      error: err instanceof Error ? err.message : "Execution failed.",
    };
  }
}
