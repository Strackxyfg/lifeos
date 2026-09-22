import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/agent/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeSnapshot } from "@/lib/data/workspace";
import { readProfileAnswers } from "@/lib/onboarding";
import { toBrainLink } from "@/lib/brain/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only context for the remote runner.
 *
 * Returns the user's second brain and workspace aggregates — never secrets,
 * never tokens, never another user's rows. This is the *only* way the runner
 * sees data; it has no database credentials of its own.
 */
export async function GET(req: Request) {
  const auth = await authenticateRunner(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createAdminClient();
  const scope = (t: string) => db.from(t).select("*").eq("user_key", auth.userKey);

  const [projects, deals, transactions, tasks, brain, policy, profile, links] = await Promise.all([
    scope("lifeos_projects"),
    scope("lifeos_deals"),
    scope("lifeos_transactions"),
    scope("lifeos_tasks"),
    scope("lifeos_brain_items"),
    db.from("agent_policies").select("*").eq("user_key", auth.userKey).maybeSingle(),
    // Before migration 007 the table is missing: `data` is null and the
    // profile is simply absent, like for someone who skipped onboarding.
    db.from("lifeos_profiles").select("name, profession, answers").eq("user_key", auth.userKey).maybeSingle(),
    // What the notes mean to each other (migrations 007–008). Selected with
    // "*" so rows from before 008, without kind or direction, still come back.
    scope("lifeos_brain_links"),
  ]);

  const rows = {
    projects: projects.data ?? [],
    deals: deals.data ?? [],
    transactions: transactions.data ?? [],
    tasks: tasks.data ?? [],
    brain: brain.data ?? [],
  };

  const snapshot = computeSnapshot({
    projects: rows.projects.map((p) => ({ name: p.name, status: p.status, progress: p.progress, due: p.due })),
    deals: rows.deals.map((d) => ({ stage: d.stage, value: Number(d.value), company: d.company, next: d.next })),
    transactions: rows.transactions.map((t) => ({ type: t.type, amount: Number(t.amount), category: t.category })),
    tasks: rows.tasks.map((t) => ({ done: t.done })),
  });

  return NextResponse.json({
    // Who the person is, as told at onboarding.
    profile: profile.data
      ? {
          name: profile.data.name,
          profession: profile.data.profession,
          areas: readProfileAnswers(profile.data.answers).areas,
        }
      : null,
    snapshot,
    brain: rows.brain.map((b) => ({
      id: b.id, category: b.category, kind: b.kind,
      title: b.title, detail: b.detail, done: b.done,
    })),
    connections: (links.data ?? []).map((l) => {
      const link = toBrainLink({
        id: l.id, fromId: l.from_id, toId: l.to_id, reason: l.reason,
        origin: l.origin, kind: l.kind, sourceId: l.source_id,
      });
      return {
        fromId: link.fromId, toId: link.toId, kind: link.kind, sourceId: link.sourceId,
        reason: link.reason, reviewed: link.origin !== "ai" && link.origin !== "agent",
      };
    }),
    projects: rows.projects.map((p) => ({
      id: p.id, name: p.name, status: p.status, due: p.due, progress: p.progress,
    })),
    policy: policy.data
      ? {
          autonomy: policy.data.autonomy,
          killSwitch: policy.data.kill_switch,
          verbosity: policy.data.verbosity,
        }
      : { autonomy: "observe", killSwitch: true, verbosity: "detailed" },
  });
}
