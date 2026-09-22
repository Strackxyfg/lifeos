import "server-only";
import { getStore } from "@/lib/db/store";
import type { DealStage } from "@/lib/data/workspace";
import { isCategory, kindForCategory } from "@/lib/data/brain";
import { isMissingTable } from "@/lib/data/live";
import { toBrainNotes } from "@/lib/brain/load";
import { brainIndex, brainSearch } from "@/lib/brain/agent-views";
import { aboutSection } from "@/lib/brain/context";
import { contextLabels } from "@/lib/brain/labels";
import { readProfileAnswers } from "@/lib/onboarding";
import { canonicalPair, liveLinks, sameLink } from "@/lib/brain/graph";
import { computeSnapshot } from "@/lib/data/workspace";
import { snapshotFacts } from "@/lib/ai/insights";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { DbBrainLink } from "@/lib/db/types";
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
/**
 * `detail` is a short summary and goes into the audit log. `data` is what a
 * read returns to the caller, and deliberately does *not* go into the audit:
 * copying the whole brain into the log on every read would duplicate personal
 * data into a table built to be append-only.
 */
export type ExecuteResult =
  | { ok: true; detail: string; data?: string }
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
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  // The brain as the agent sees it. Links tolerate migration 007 not having
  // run yet: an agent should still read notes while connections are pending.
  const loadBrain = async () => {
    const notes = toBrainNotes(await store.list(userKey, "brain"), dictionaries.en);
    let links: DbBrainLink[] = [];
    try {
      links = liveLinks(await store.list(userKey, "links"), notes);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
    return { notes, links };
  };

  // Who the person is, from onboarding — so the agent on Telegram knows what
  // the assistant in the app knows. Optional until migration 007 has run.
  const loadAbout = async () => {
    try {
      const p = await store.getProfile(userKey);
      if (!p) return null;
      const en = dictionaries.en;
      return aboutSection(
        {
          name: p.name ?? undefined,
          profession: p.profession ?? undefined,
          areas: readProfileAnswers(p.answers).areas.map((a) => en.onboarding.areas[a]),
        },
        contextLabels(en, "en")
      );
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      return null;
    }
  };

  try {
    switch (capabilityId) {
      // Reads used to answer "Read granted." with nothing attached — the agent
      // was allowed to read the brain and given no way to. They return data now.
      case "brain.read": {
        const [{ notes, links }, about] = await Promise.all([loadBrain(), loadAbout()]);
        const index = brainIndex(notes, links);
        return { ok: true, detail: `Read ${notes.length} notes.`, data: about ? `${about}\n\n${index}` : index };
      }

      case "brain.search": {
        const query = str(payload.query, 200);
        if (!query) return { ok: false, error: "A search needs a query.", code: "invalid_payload" };
        const { notes, links } = await loadBrain();
        return { ok: true, detail: `Searched for "${query.slice(0, 60)}".`, data: brainSearch(notes, links, query) };
      }

      case "workspace.read": {
        const [projects, deals, transactions, tasks] = await Promise.all([
          store.list(userKey, "projects"),
          store.list(userKey, "deals"),
          store.list(userKey, "transactions"),
          store.list(userKey, "tasks"),
        ]);
        const facts = snapshotFacts(computeSnapshot({ projects, deals, transactions, tasks }), "en");
        return { ok: true, detail: "Read the workspace summary.", data: facts };
      }

      case "analyze":
        return { ok: true, detail: "Analysis runs in the model; nothing to fetch." };

      case "brain.write": {
        const title = str(payload.title);
        if (!title) return { ok: false, error: "A note needs a title.", code: "invalid_payload" };
        const category = isCategory(payload.category) ? payload.category : "thoughts";
        const note = await store.insert(userKey, "brain", {
          category,
          kind: kindForCategory[category],
          seedKey: null,
          title,
          detail: str(payload.detail, 20_000),
          done: false,
          // The agent wrote it — unlike a person's capture, which is theirs.
          ai: true,
        });
        return { ok: true, detail: `Captured "${title.slice(0, 60)}" under ${category}.`, data: `id: ${note.id}` };
      }

      case "brain.link": {
        const a = str(payload.a ?? payload.from, 64);
        const b = str(payload.b ?? payload.to, 64);
        if (!a || !b || a.toLowerCase() === b.toLowerCase()) {
          return { ok: false, error: "Linking needs two different note ids.", code: "invalid_payload" };
        }
        // Same ownership rule as the app: both ends must be this user's notes.
        const { notes, links } = await loadBrain();
        const mine = new Set(notes.map((n) => n.id.toLowerCase()));
        if (!mine.has(a.toLowerCase()) || !mine.has(b.toLowerCase())) {
          return { ok: false, error: "One of those notes does not exist.", code: "invalid_payload" };
        }
        if (links.some((l) => sameLink(l, a, b))) return { ok: true, detail: "Already connected." };

        const [fromId, toId] = canonicalPair(a, b);
        await store.insert(userKey, "links", {
          fromId,
          toId,
          reason: str(payload.reason, 300),
          origin: "suggested",
        });
        return { ok: true, detail: "Connected the two notes." };
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

      case "deal.write": {
        const name = str(payload.name ?? payload.title, 120);
        if (!name) return { ok: false, error: "A deal needs a name.", code: "invalid_payload" };
        const stage = ["Lead", "Qualified", "Proposal", "Won", "Lost"].includes(String(payload.stage))
          ? (payload.stage as string)
          : "Lead";
        const value = Number(payload.value);
        await store.insert(userKey, "deals", {
          name,
          company: str(payload.company, 120) ?? "",
          stage: stage as DealStage,
          value: Number.isFinite(value) && value >= 0 ? value : 0,
          owner: str(payload.owner, 60) ?? "Agent",
          next: str(payload.next, 200) ?? "",
        });
        return { ok: true, detail: `Deal "${name.slice(0, 60)}" at stage ${stage}.` };
      }

      // ── Drafting ────────────────────────────────────────────────────
      // These write only into `agent_drafts`. Nothing reaches a recipient or
      // an ad account here — that is the whole point of the tier split.
      case "email.draft":
      case "campaign.draft":
      case "proposal.draft": {
        const kind = capabilityId.split(".")[0] as "email" | "campaign" | "proposal";
        const body = str(payload.body ?? payload.content, 20_000);
        if (!body) return { ok: false, error: "A draft needs a body.", code: "invalid_payload" };

        const { createDraft } = await import("./drafts");
        const draft = await createDraft(userKey, {
          kind,
          target: str(payload.to ?? payload.target ?? payload.audience, 200),
          subject: str(payload.subject ?? payload.name, 300),
          body,
          meta: isRecord(payload.meta) ? payload.meta : null,
        });
        return {
          ok: true,
          detail: `Drafted ${kind} "${(draft.subject ?? body).slice(0, 60)}" — waiting for your approval.`,
        };
      }

      case "email.send": {
        const to = str(payload.to ?? payload.target, 200);
        const subject = str(payload.subject, 300);
        const body = str(payload.body ?? payload.content, 20_000);
        if (!to || !subject || !body) {
          return { ok: false, error: "An email needs to, subject and body.", code: "invalid_payload" };
        }
        const { sendEmail } = await import("./email");
        const sent = await sendEmail({ to, subject, body });
        if (!sent.ok) return { ok: false, error: sent.error, code: "failed" };
        return { ok: true, detail: `Sent to ${to} (${sent.id}).` };
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
