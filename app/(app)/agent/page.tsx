import type { Metadata } from "next";
import Link from "next/link";
import { Bot, ShieldAlert, ArrowRight, Check, ShieldX, UserCheck, MessageSquare } from "lucide-react";
import { AgentChat } from "@/components/agent/agent-chat";
import { AutonomyPicker } from "@/components/agent/autonomy-picker";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import {
  KillSwitch, Approvals, TaskComposer, TaskList, RunnerToken,
} from "@/components/agent/agent-controls";
import { loadAgentState } from "@/lib/agent/store";
import { CAPABILITIES } from "@/lib/agent/capabilities";
import { decide } from "@/lib/agent/policy";
import { getMessages } from "@/lib/i18n/server";
import { getLocale } from "@/lib/i18n/server";
import { formatCurrency, cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agent" };

const AUTONOMY_KEY = {
  observe: "autonomyObserve",
  assist: "autonomyAssist",
  act: "autonomyAct",
  extend: "autonomyExtend",
} as const;

export default async function AgentPage() {
  const [m, locale, state] = await Promise.all([getMessages(), getLocale(), loadAgentState()]);

  if (!state.available) {
    return (
      <>
        <PageHeader title={m.agent.title} description={m.agent.desc} />
        <Card>
          <EmptyState icon={Bot} title={m.agent.unavailable} />
        </Card>
      </>
    );
  }

  // The gate: no valid assessment means no agent, only an invitation to take it.
  if (!state.assessment?.valid) {
    return (
      <>
        <PageHeader title={m.agent.title} description={m.agent.desc} />
        <Card className="mx-auto max-w-lg">
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl border border-border bg-surface-2 text-accent">
              <UserCheck className="h-5 w-5" />
            </span>
            <p className="mt-5 text-[1.0625rem] font-medium tracking-tight">{m.agent.gateTitle}</p>
            <p className="mt-2 max-w-sm text-[0.875rem] leading-relaxed text-muted-foreground">
              {m.agent.gateDesc}
            </p>
            {state.assessment && !state.assessment.valid && (
              <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[0.78rem] text-warning">
                {m.agent.invalidProfile}
              </p>
            )}
            <Link href="/assessment" className={cn(buttonVariants({ size: "lg" }), "mt-7 gap-2")}>
              {state.assessment ? m.assessment.retake : m.assessment.startCta}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>
      </>
    );
  }

  const usage = {
    runsToday: state.runsToday,
    spentTodayCents: state.spentTodayCents,
    killSwitchOn: state.killSwitch,
  };

  return (
    <>
      <PageHeader title={m.agent.title} description={m.agent.desc} />

      {/* Messaging — the reason the agent is reachable at all */}
      <Card className="mb-3">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-accent" />
              {m.agent.chatTitle}
            </span>
          }
        />
        <AgentChat messages={state.messages} runnerOnline={state.hasToken} />
      </Card>

      {/* Status */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-[0.75rem] text-muted-foreground">{m.agent.autonomy}</p>
          <p className="mt-1.5 text-lg font-medium capitalize tracking-tight">{state.policy.autonomy}</p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
            {m.agent[AUTONOMY_KEY[state.policy.autonomy]]}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[0.75rem] text-muted-foreground">{m.agent.budget}</p>
          <p className="mt-1.5 text-lg font-medium tracking-tight">
            {formatCurrency(state.spentTodayCents / 100)}{" "}
            <span className="text-sm text-muted-foreground">
              / {formatCurrency(state.policy.dailyBudgetCents / 100)}
            </span>
          </p>
          <p className="mt-1 text-[0.75rem] text-muted-foreground">
            {m.agent.runs}: {state.runsToday} / {state.policy.dailyRunLimit}
          </p>
        </Card>
        <KillSwitch on={state.killSwitch} />
      </div>

      {/* Approvals */}
      <Card className="mt-3">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-warning" />
              {m.agent.pendingApprovals}
              {state.approvals.length > 0 && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[0.68rem] text-warning">
                  {state.approvals.length}
                </span>
              )}
            </span>
          }
        />
        <Approvals approvals={state.approvals} />
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title={m.agent.autonomy} />
          <AutonomyPicker current={state.policy.autonomy} recommended={state.recommended} />
        </Card>
        <Card>
          <CardHeader title={m.agent.newTask} />
          <TaskComposer />
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader title={m.agent.tasks} />
        <TaskList tasks={state.tasks} />
      </Card>

      {/* What the agent may do, at this exact policy */}
      <Card className="mt-3">
        <CardHeader title={m.agent.capabilities} />
        <ul className="divide-y divide-border">
          {CAPABILITIES.map((c) => {
            const d = decide(c.id, state.policy, usage);
            // `deny` must never be dressed up as "needs approval" — with the
            // kill switch on, even safe reads are blocked outright.
            const tone =
              c.tier === "forbidden"
                ? { icon: ShieldX, cls: "text-danger", label: m.agent.tierForbidden }
                : d.action === "deny"
                  ? { icon: ShieldX, cls: "text-danger", label: m.agent.tierBlocked }
                  : d.action === "allow"
                    ? { icon: Check, cls: "text-success", label: m.agent.tierSafe }
                    : { icon: ShieldAlert, cls: "text-warning", label: m.agent.tierApproval };
            const Icon = tone.icon;
            return (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <Icon className={cn("h-4 w-4 shrink-0", tone.cls)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{locale === "fr" ? c.labelFr : c.label}</p>
                  <p className="text-[0.72rem] text-muted-foreground">{c.rationale}</p>
                </div>
                <span className={cn("shrink-0 text-[0.72rem]", tone.cls)}>{tone.label}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Runner credentials */}
      <Card className="mt-3">
        <CardHeader title={m.agent.runner} />
        <RunnerToken hasToken={state.hasToken} />
      </Card>

      <p className="mt-6 text-center text-[0.72rem] text-muted">
        <Link href="/assessment" className="underline-offset-4 hover:underline">
          {m.assessment.retake}
        </Link>
      </p>
    </>
  );
}
