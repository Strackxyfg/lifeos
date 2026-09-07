"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Sparkles, ArrowRight } from "lucide-react";
import { planFromAnswers, type OnboardingAnswers } from "@/lib/onboarding";
import { genPhases, type GenStreamEvent } from "@/lib/notion/phases";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

/** Marks this onboarding as already built, so a remount can't rebuild it. */
export const GENERATED_KEY = "lifeos:generated";

function markGenerated(mode?: "live" | "simulated", url?: string, count?: number) {
  try {
    sessionStorage.setItem(GENERATED_KEY, JSON.stringify({ mode, url, count }));
  } catch {}
}

export function Generator() {
  const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>({});
  const [current, setCurrent] = useState(0);
  const [detail, setDetail] = useState<string>("");
  const [done, setDone] = useState(false);
  const [mode, setMode] = useState<"live" | "simulated" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspaceUrl, setWorkspaceUrl] = useState<string | null>(null);
  const [builtCount, setBuiltCount] = useState<number | null>(null);
  const started = useRef(false);

  const plan = useMemo(() => planFromAnswers(answers), [answers]);
  const name = answers.name?.split(" ")[0] ?? "there";

  // Load answers first.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lifeos:onboarding");
      if (raw) setAnswers(JSON.parse(raw));
    } catch {}
  }, []);

  // Drive progress from the server stream (with a local fallback).
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Generation writes into Notion, so it must never run twice for the same
    // onboarding: a page refresh (or a dev Fast Refresh remount) would build a
    // duplicate workspace. The wizard clears this key when new answers are
    // submitted, so a genuine re-run still regenerates.
    try {
      const prior = sessionStorage.getItem(GENERATED_KEY);
      if (prior) {
        const { mode: m, url, count } = JSON.parse(prior) as {
          mode?: "live" | "simulated"; url?: string; count?: number;
        };
        setMode(m ?? null);
        setWorkspaceUrl(url ?? null);
        if (count) setBuiltCount(count);
        setCurrent(genPhases.length);
        setDone(true);
        return;
      }
    } catch {}

    const localFallback = () => {
      let i = 0;
      const tick = () => {
        if (i >= genPhases.length) return setDone(true);
        setCurrent(i);
        setDetail(genPhases[i].detail(plan));
        const ms = genPhases[i].ms;
        i += 1;
        setTimeout(tick, ms);
      };
      tick();
    };

    const stream = async () => {
      // Read answers fresh (state may not have hydrated into this closure yet).
      let body: Partial<OnboardingAnswers> = {};
      try {
        const raw = sessionStorage.getItem("lifeos:onboarding");
        if (raw) body = JSON.parse(raw);
      } catch {}
      try {
        const res = await fetch("/api/generate/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.body) throw new Error("no stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;

        const handle = (raw: string) => {
          const line = raw.trim();
          if (!line.startsWith("data:")) return;
          let e: GenStreamEvent;
          try {
            e = JSON.parse(line.slice(5).trim()) as GenStreamEvent;
          } catch {
            return; // ignore a malformed frame rather than abandoning the stream
          }
          if (e.mode) setMode(e.mode);
          if (e.state === "error") {
            setError(e.detail ?? "Generation failed.");
            finished = true;
            return;
          }
          if (e.state === "done") {
            setCurrent(genPhases.length);
            if (e.workspaceUrl) setWorkspaceUrl(e.workspaceUrl);
            // Report what the server actually created, not what we predicted.
            if (e.plan?.length) setBuiltCount(e.plan.length);
            setDone(true);
            finished = true;
            markGenerated(e.mode, e.workspaceUrl, e.plan?.length);
          } else {
            setCurrent(e.index);
            if (e.detail) setDetail(e.detail);
          }
        };

        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          blocks.forEach(handle);
        }

        // Flush anything left without a trailing blank line.
        if (buffer.trim()) handle(buffer);

        // The server closed the stream. If a terminal event was lost in
        // transit, finish anyway — never leave the user on a frozen screen.
        if (!finished) {
          setCurrent(genPhases.length);
          setDone(true);
          markGenerated();
        }
      } catch (err) {
        // Only fall back to the local timeline if nothing was received at all;
        // otherwise surface the failure instead of faking progress.
        if (current === 0) localFallback();
        else setError(err instanceof Error ? err.message : "Connection lost.");
      }
    };

    // Fire immediately — `stream()` reads sessionStorage itself, so there is
    // nothing to wait for. Deliberately no cleanup: under StrictMode the first
    // cleanup would cancel the run while the `started` guard blocks the second
    // mount from ever restarting it, leaving the UI frozen on phase 0.
    void stream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = done ? 100 : Math.round((current / genPhases.length) * 100);

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid mask-fade-b absolute inset-0 opacity-[0.25]" />
        <div className="absolute left-1/2 top-1/3 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-accent/10 blur-[110px]" />
      </div>

      <div className="w-full max-w-lg">
        <AnimatePresence mode="wait">
          {!done ? (
            <motion.div key="building" exit={{ opacity: 0, y: -8 }}>
              <div className="mb-8 text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                  className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border bg-surface"
                >
                  <Sparkles className="h-5 w-5 text-accent" />
                </motion.div>
                <h1 className="mt-5 text-h2 tracking-tight">Building your LifeOS</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Hang tight, {name} — assembling a system around your answers.
                </p>
                {mode === "simulated" && (
                  <p className="mx-auto mt-3 w-fit rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-[0.72rem] text-warning">
                    Preview only — Notion isn&apos;t connected, nothing is being created.
                  </p>
                )}
                {mode === "live" && (
                  <p className="mx-auto mt-3 w-fit rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[0.72rem] text-success">
                    Writing into your Notion workspace
                  </p>
                )}
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[0.8125rem] text-danger">
                  {error}
                </div>
              )}

              <div className="mb-6 h-1 overflow-hidden rounded-full bg-border">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, ease }}
                />
              </div>

              <ol className="rounded-xl border border-border bg-surface/60 p-2">
                {genPhases.map((p, i) => {
                  const state = i < current ? "done" : i === current ? "active" : "pending";
                  return (
                    <li
                      key={p.key}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                        state === "active" && "bg-surface-2"
                      )}
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center">
                        {state === "done" && <Check className="h-4 w-4 text-success" />}
                        {state === "active" && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                        {state === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />}
                      </span>
                      <span className="flex-1">
                        <span className={cn("block text-sm transition-colors", state === "pending" ? "text-muted" : "text-foreground")}>
                          {p.label}
                        </span>
                        {state === "active" && (
                          <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="block font-mono text-[0.72rem] text-muted-foreground"
                          >
                            {detail || p.detail(plan)}
                          </motion.span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease }}
              className="text-center"
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-success/30 bg-success/10">
                <Check className="h-6 w-6 text-success" />
              </div>
              <h1 className="mt-6 text-h2 tracking-tight">
                {mode === "simulated" ? "Preview complete." : "Your workspace is ready."}
              </h1>
              <p className="mx-auto mt-3 max-w-sm text-[0.9375rem] text-muted-foreground">
                {mode === "simulated" ? (
                  <>
                    This was a preview — connect Notion to actually build the{" "}
                    {builtCount ?? plan.length} databases, dashboards and automations.
                  </>
                ) : (
                  <>
                    {builtCount ?? plan.length} databases, dashboards, automations, and your assistant —
                    built for {name} in your Notion workspace.
                  </>
                )}
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-transform duration-200 active:scale-[0.985]"
                >
                  Open your workspace <ArrowRight className="h-4 w-4" />
                </Link>
                {workspaceUrl && (
                  <a
                    href={workspaceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-6 py-3 text-sm font-medium transition-colors hover:border-border-strong"
                  >
                    View in Notion <ArrowRight className="h-4 w-4" />
                  </a>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
