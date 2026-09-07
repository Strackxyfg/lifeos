"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X, Loader2, Power, KeyRound, Copy, Plus, Trash2 } from "lucide-react";
import {
  setKillSwitch, resolveApproval, createAgentTask, cancelAgentTask,
  mintRunnerToken, revokeRunnerTokens, type AgentResult,
} from "@/app/actions/agent";
import { CAPABILITIES, getCapability } from "@/lib/agent/capabilities";
import type { PendingApproval, AgentTask } from "@/lib/agent/store";
import { toast } from "@/components/ui/toaster";
import { SwitchTrack } from "@/components/ui/switch";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

/* ── Kill switch ──────────────────────────────────────────────────── */

export function KillSwitch({ on }: { on: boolean }) {
  const m = useMessages();
  const router = useRouter();
  const [local, setLocal] = useState(on);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !local;
    setLocal(next);
    start(async () => {
      const res = await setKillSwitch(next);
      if (!res.ok) {
        setLocal(!next);
        toast(res.error, "error");
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className={cn("rounded-xl border p-5 transition-colors", local ? "border-danger/40 bg-danger/5" : "border-border bg-surface")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Power className={cn("h-4 w-4", local ? "text-danger" : "text-success")} />
            {local ? m.agent.killSwitchOn : m.agent.killSwitchOff}
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
            {m.agent.killSwitchHint}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={local}
          aria-label={m.agent.killSwitch}
          onClick={toggle}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <SwitchTrack on={local} pending={pending} />
        </button>
      </div>
    </div>
  );
}

/* ── Pending approvals ────────────────────────────────────────────── */

export function Approvals({ approvals }: { approvals: PendingApproval[] }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = async (id: string, approve: boolean) => {
    setBusy(id);
    const res = await resolveApproval(id, approve);
    setBusy(null);
    if (!res.ok) toast(res.error, "error");
    else router.refresh();
  };

  if (approvals.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{m.agent.noApprovals}</p>;
  }

  return (
    <ul className="divide-y divide-border">
      <AnimatePresence initial={false}>
        {approvals.map((a) => {
          const cap = getCapability(a.capability);
          return (
            <motion.li
              key={a.id}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease }}
              className="flex items-start gap-4 overflow-hidden px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {cap ? (locale === "fr" ? cap.labelFr : cap.label) : a.capability}
                </p>
                <p className="mt-1 text-[0.78rem] leading-relaxed text-muted-foreground">{a.reason}</p>
                {a.payload && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-md border border-border bg-surface-2/50 p-2 font-mono text-[0.68rem] text-muted-foreground">
                    {JSON.stringify(a.payload, null, 1)}
                  </pre>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => resolve(a.id, false)}
                  disabled={busy === a.id}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1")}
                >
                  <X className="h-3.5 w-3.5" /> {m.agent.decline}
                </button>
                <button
                  onClick={() => resolve(a.id, true)}
                  disabled={busy === a.id}
                  className={cn(buttonVariants({ variant: "accent", size: "sm" }), "gap-1")}
                >
                  {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {m.agent.approve}
                </button>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

/* ── Task authoring ───────────────────────────────────────────────── */

const initial: AgentResult = { ok: true };

function TaskSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

export function TaskComposer() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [state, action] = useActionState(createAgentTask, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef(state);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.ok) {
      formRef.current?.reset();
      toast(m.agent.created);
      router.refresh();
    }
  }, [state, m, router]);

  // Forbidden capabilities are never offered — they can't be delegated at all.
  const selectable = CAPABILITIES.filter((c) => c.tier !== "forbidden");

  return (
    <form ref={formRef} action={action} className="space-y-3 p-5">
      <label className="block">
        <span className="mb-1.5 block text-[0.75rem] text-muted-foreground">{m.agent.taskTitle}</span>
        <input
          name="title"
          required
          maxLength={120}
          className="h-10 w-full rounded-lg border border-border bg-surface-2/40 px-3 text-sm outline-none focus:border-border-strong"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[0.75rem] text-muted-foreground">{m.agent.taskInstruction}</span>
        <textarea
          name="instruction"
          required
          rows={3}
          maxLength={2000}
          className="w-full resize-y rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm outline-none focus:border-border-strong"
        />
      </label>

      <div>
        <span className="mb-2 block text-[0.75rem] text-muted-foreground">{m.agent.taskCapabilities}</span>
        <div className="flex flex-wrap gap-1.5">
          {selectable.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 text-[0.72rem] text-muted-foreground transition-colors has-[:checked]:border-accent/50 has-[:checked]:bg-accent/10 has-[:checked]:text-foreground"
            >
              <input type="checkbox" name="capabilities" value={c.id} className="sr-only" />
              {locale === "fr" ? c.labelFr : c.label}
            </label>
          ))}
        </div>
      </div>

      {!state.ok && <p className="text-[0.8125rem] text-danger">{state.error}</p>}
      <TaskSubmit label={m.agent.newTask} />
    </form>
  );
}

export function TaskList({ tasks }: { tasks: AgentTask[] }) {
  const m = useMessages();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (tasks.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{m.agent.noTasks}</p>;
  }

  const cancel = async (id: string) => {
    setBusy(id);
    const res = await cancelAgentTask(id);
    setBusy(null);
    if (!res.ok) toast(res.error, "error");
    else router.refresh();
  };

  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-start gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[0.75rem] text-muted-foreground">{t.instruction}</p>
          </div>
          <span className="rounded-full border border-border bg-surface-2/50 px-2 py-0.5 text-[0.68rem] text-muted-foreground">
            {t.status}
          </span>
          {t.status !== "cancelled" && (
            <button
              onClick={() => cancel(t.id)}
              disabled={busy === t.id}
              aria-label={m.agent.cancel}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Runner token ─────────────────────────────────────────────────── */

export function RunnerToken({ hasToken }: { hasToken: boolean }) {
  const m = useMessages();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const mint = () =>
    start(async () => {
      const res = await mintRunnerToken();
      if (!res.ok) return toast(res.error, "error");
      setToken(res.token);
      router.refresh();
    });

  const revoke = () =>
    start(async () => {
      const res = await revokeRunnerTokens();
      if (!res.ok) return toast(res.error, "error");
      setToken(null);
      toast(m.agent.revoked);
      router.refresh();
    });

  return (
    <div className="space-y-3 p-5">
      <p className="text-[0.78rem] leading-relaxed text-muted-foreground">{m.agent.runnerDesc}</p>

      {token && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="mb-2 text-[0.72rem] text-accent">{m.agent.tokenOnce}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1.5 font-mono text-[0.72rem]">
              {token}
            </code>
            <button
              onClick={() => { navigator.clipboard?.writeText(token); toast("Copied"); }}
              aria-label="Copy"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border hover:bg-surface-2"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={mint} disabled={pending} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {m.agent.mintToken}
        </button>
        {hasToken && (
          <button
            onClick={revoke}
            disabled={pending}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-danger hover:bg-danger/10")}
          >
            {m.agent.revokeToken}
          </button>
        )}
        <span className="text-[0.72rem] text-muted">
          {hasToken ? m.agent.tokenActive : m.agent.tokenNone}
        </span>
      </div>
    </div>
  );
}
