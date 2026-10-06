"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, ExternalLink, KeyRound, Loader2, Server, ShieldCheck, TerminalSquare, TriangleAlert } from "lucide-react";
import { getRunnerStatus, mintRunnerToken, revokeRunnerTokens } from "@/app/actions/agent";
import { installCommand, runnerState, type RunnerInfo, type RunnerState } from "@/lib/agent/runner-status";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/** Copies a text, with a word of thanks; falls back to a selection where the clipboard API is off (plain http). */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useMessages().agentSetup;
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label ?? t.copy}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground"
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span aria-live="polite">{done ? t.copied : t.copy}</span>
    </button>
  );
}

/** A line to type on the server, wrapped on a phone rather than cut off. */
function CommandLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-2.5">
      <code className="min-w-0 flex-1 break-all font-mono text-[0.75rem] leading-relaxed text-foreground/90">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

/** "12 s", "5 min", "3 h", "2 d" — how long, compactly. */
function duration(seconds: number, locale: "en" | "fr"): string {
  const day = locale === "fr" ? "j" : "d";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} ${day}`;
}

const STATE_TONE: Record<RunnerState, string> = {
  none: "border-border text-muted-foreground",
  never: "border-warning/40 bg-warning/10 text-warning",
  online: "border-success/40 bg-success/10 text-success",
  offline: "border-danger/40 bg-danger/10 text-danger",
};

/**
 * Putting the agent on a server, step by step — and, once it runs, whether
 * LifeOS hears it. The status is what LifeOS itself saw (the token's last
 * use), checked every few seconds while the installer works on the server,
 * every half minute once the agent is there.
 */
export function RunnerSetup({
  runner,
  origin,
  local,
  renderedAt,
}: {
  runner: RunnerInfo;
  origin: string;
  local: boolean;
  /** The server's clock when the page was made: the first render matches it, so "heard 12 s ago" hydrates as rendered. */
  renderedAt: number;
}) {
  const m = useMessages();
  const t = m.agentSetup;
  const locale = useLocale();
  const router = useRouter();
  const [info, setInfo] = useState(runner);
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [now, setNow] = useState(renderedAt);
  const { state, secondsAgo } = runnerState(info, now);
  const [open, setOpen] = useState(state !== "online");
  const previous = useRef<RunnerState>(state);

  useEffect(() => setInfo(runner), [runner]);

  // While waiting for the agent, every 4 s; once it is there, every 30 s.
  const poll = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const res = await getRunnerStatus();
    if (res.ok) setInfo(res.runner);
    setNow(Date.now());
  }, []);
  useEffect(() => {
    const id = setInterval(() => void poll(), state === "online" ? 30_000 : 4_000);
    return () => clearInterval(id);
  }, [poll, state]);
  // The "heard 12 s ago" keeps counting between checks.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // The moment it connects: say so, and let the rest of the page know (the messages stop warning).
  useEffect(() => {
    if (previous.current !== "online" && state === "online") {
      toast(t.step4.done);
      router.refresh();
    }
    previous.current = state;
  }, [state, t.step4.done, router]);

  const mint = () =>
    start(async () => {
      const res = await mintRunnerToken();
      if (!res.ok) return toast(res.error, "error");
      setToken(res.token);
      setInfo({ tokenActive: true, lastSeen: null });
      setOpen(true);
    });

  const revoke = () =>
    start(async () => {
      const res = await revokeRunnerTokens();
      if (!res.ok) return toast(res.error, "error");
      setToken(null);
      setInfo({ tokenActive: false, lastSeen: null });
      toast(t.revoked);
      router.refresh();
    });

  const label =
    state === "online"
      ? fill(t.state.online, {
          ago: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-(secondsAgo ?? 0), "second"),
        })
      : state === "offline"
        ? fill(t.state.offline, { ago: duration(secondsAgo ?? 0, locale) })
        : t.state[state];

  const command = installCommand(origin, locale);
  const commands = ["status", "logs", "update", "token", "config", "doctor", "uninstall"] as const;

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <Server className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="min-w-0 flex-1 text-[0.9375rem] font-medium tracking-tight">{t.title}</h3>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-medium", STATE_TONE[state])} role="status" aria-live="polite">
          <span className={cn("h-1.5 w-1.5 rounded-full bg-current", state === "never" && "motion-safe:animate-pulse")} aria-hidden />
          {label}
        </span>
      </div>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">{t.intro}</p>

      {local && (
        <p className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[0.78rem] leading-relaxed text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {fill(t.local, { origin })}
        </p>
      )}

      {state === "online" && <p className="mt-3 text-[0.8125rem] text-foreground">{t.connected}</p>}
      {state === "offline" && <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">{t.offlineHelp}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {state === "online" && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            {open ? t.hide : t.show}
          </button>
        )}
        {info.tokenActive && (
          <button
            type="button"
            onClick={revoke}
            disabled={pending}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-danger hover:bg-danger/10")}
          >
            {t.revoke}
          </button>
        )}
      </div>

      {open && (
        <ol className="mt-5 space-y-5">
          <Step n={1} title={t.step1.title}>
            <p>{t.step1.body}</p>
            <CommandLine text={t.step1.ssh} />
            <p className="text-[0.75rem] text-muted">{t.step1.none}</p>
          </Step>

          <Step n={2} title={t.step2.title}>
            <p>{t.step2.body}</p>
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] text-accent underline-offset-4 hover:underline"
            >
              {t.step2.groq} <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </Step>

          <Step n={3} title={t.step3.title}>
            <p>{t.step3.body}</p>
            {token ? (
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[0.75rem] text-accent">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                  {t.step3.tokenOnce}
                </p>
                <CommandLine text={token} />
              </div>
            ) : (
              <div className="space-y-2">
                {info.tokenActive && <p className="text-[0.75rem] leading-relaxed text-warning">{t.step3.replaceWarning}</p>}
                <button type="button" onClick={mint} disabled={pending} className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <KeyRound className="h-3.5 w-3.5" aria-hidden />}
                  {info.tokenActive ? t.step3.regenerate : t.step3.generate}
                </button>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-foreground">
              <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {t.step3.command}
            </p>
            <CommandLine text={command} />
            <p className="text-[0.75rem] leading-relaxed text-muted">{t.step3.commandHint}</p>
          </Step>

          <Step n={4} title={t.step4.title}>
            {state === "online" ? (
              <p className="flex items-center gap-2 text-success">
                <Check className="h-4 w-4" aria-hidden />
                {t.step4.done}
              </p>
            ) : state === "none" ? (
              <p>{t.step4.idle}</p>
            ) : (
              // Never heard, or silent: watching for it, every 4 seconds.
              <p className="flex items-start gap-2">
                <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                {state === "never" ? t.neverHelp : t.step4.watching}
              </p>
            )}
          </Step>
        </ol>
      )}

      <details className="group mt-5 rounded-lg border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[0.8125rem] font-medium [&::-webkit-details-marker]:hidden">
          {t.commands.title}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="divide-y divide-border border-t border-border">
          {commands.map((c) => (
            <div key={c} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
              <dt className="font-mono text-[0.75rem] text-foreground sm:w-48 sm:shrink-0">lifeos-agent {c}</dt>
              <dd className="text-[0.75rem] text-muted-foreground">{t.commands[c]}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="mt-4 flex gap-2 text-[0.72rem] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        {t.safety}
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-[0.72rem] font-medium tabular-nums" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
        <p className="text-[0.875rem] font-medium text-foreground">{title}</p>
        {children}
      </div>
    </li>
  );
}
