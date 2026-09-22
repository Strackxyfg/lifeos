"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Check, ExternalLink, Loader2, NotebookPen } from "lucide-react";
import { GENERATION_STEPS, type GenerationStep, type GenStreamEvent } from "@/lib/notion/phases";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

/**
 * Remembers a finished build for this tab. A build writes into Notion, so a
 * refresh must show the result, not offer to build a second copy.
 */
const BUILT_KEY = "lifeos:notion-built";

type State =
  | { kind: "ready" }
  | { kind: "running"; step: GenerationStep; progress: number; db?: string }
  | { kind: "done"; databases: number; workspaceUrl?: string }
  | {
      kind: "error";
      message?: string;
      /** Whether the build got past checking access, so something may exist in Notion. */
      wrote: boolean;
      notConnected?: boolean;
    };

/**
 * The optional Notion export. Nothing starts until the person says so: the
 * screen first shows exactly what will be written, because it is written into
 * their own Notion and cannot be undone from here.
 */
export function Generator({ planned }: { planned: string[] }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.notionBuild;
  const [state, setState] = useState<State>({ kind: "ready" });
  const running = useRef(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BUILT_KEY);
      if (!raw) return;
      const prior = JSON.parse(raw) as { databases?: unknown; workspaceUrl?: unknown };
      if (typeof prior.databases === "number") {
        setState({
          kind: "done",
          databases: prior.databases,
          workspaceUrl: typeof prior.workspaceUrl === "string" ? prior.workspaceUrl : undefined,
        });
      }
    } catch {}
  }, []);

  const build = async () => {
    if (running.current) return;
    running.current = true;
    setState({ kind: "running", step: "verify", progress: 0 });
    // Nothing is written while access is being checked; from the next step
    // on, a failure can leave part of a workspace behind in Notion.
    let wrote = false;

    try {
      const res = await fetch("/api/generate/stream", { method: "POST" });
      if (res.status === 409) {
        setState({ kind: "error", wrote: false, notConnected: true });
        return;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      const handle = (block: string) => {
        const line = block.trim();
        if (!line.startsWith("data:")) return;
        let e: GenStreamEvent;
        try {
          e = JSON.parse(line.slice(5).trim()) as GenStreamEvent;
        } catch {
          return; // a malformed frame is skipped, not fatal
        }
        if (e.state === "active") {
          if (e.step !== "verify") wrote = true;
          setState({ kind: "running", step: e.step, progress: e.progress, db: e.db });
        } else if (e.state === "done") {
          finished = true;
          setState({ kind: "done", databases: e.databases, workspaceUrl: e.workspaceUrl });
          try {
            sessionStorage.setItem(BUILT_KEY, JSON.stringify({ databases: e.databases, workspaceUrl: e.workspaceUrl }));
          } catch {}
        } else {
          finished = true;
          setState({ kind: "error", message: e.message, wrote });
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        blocks.forEach(handle);
      }
      if (buffer.trim()) handle(buffer);

      // The stream closed without a verdict. Say so — never assume success.
      if (!finished) setState({ kind: "error", wrote });
    } catch {
      setState({ kind: "error", wrote });
    } finally {
      running.current = false;
    }
  };

  const currentIndex = state.kind === "running" ? GENERATION_STEPS.indexOf(state.step) : -1;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="bg-grid mask-fade-b absolute inset-0 opacity-[0.25]" />
        <div className="absolute left-1/2 top-1/3 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-accent/10 blur-[110px]" />
      </div>

      <div className="w-full max-w-lg">
        <AnimatePresence mode="wait">
          {state.kind === "done" ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease }}
              className="text-center"
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-success/30 bg-success/10">
                <Check className="h-6 w-6 text-success" />
              </div>
              <h1 className="mt-6 text-h2 tracking-tight">{t.doneTitle}</h1>
              <p className="mx-auto mt-3 max-w-sm text-[0.9375rem] text-muted-foreground">
                {plural(locale, state.databases, t.doneBody)}
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                {state.workspaceUrl && (
                  <a
                    href={state.workspaceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background"
                  >
                    {t.viewInNotion} <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Link
                  href="/brain"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-6 py-3 text-sm font-medium transition-colors hover:border-border-strong"
                >
                  {t.back} <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>
          ) : (
            <motion.div key="build" exit={{ opacity: 0, y: -8 }}>
              <div className="mb-8 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border bg-surface">
                  <NotebookPen className="h-5 w-5 text-accent" />
                </span>
                <h1 className="mt-5 text-h2 tracking-tight">{t.title}</h1>
                <p className="mx-auto mt-3 max-w-md text-[0.9rem] leading-relaxed text-muted-foreground">{t.intro}</p>
              </div>

              {state.kind === "ready" && (
                <>
                  <p className="mb-2 text-[0.72rem] uppercase tracking-wider text-muted">{t.willCreate}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {planned.map((db) => (
                      <li key={db} className="rounded-md border border-border bg-surface/60 px-2.5 py-1 text-[0.8125rem]">
                        {db}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[0.75rem] text-muted-foreground">{t.plusHome}</p>
                  <button
                    type="button"
                    onClick={build}
                    className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-transform duration-200 active:scale-[0.985]"
                  >
                    <NotebookPen className="h-4 w-4" /> {t.start}
                  </button>
                  <Link href="/settings#connections" className="mt-3 block text-center text-[0.8125rem] text-muted-foreground hover:text-foreground">
                    {t.cancel}
                  </Link>
                </>
              )}

              {state.kind === "running" && (
                <ol className="rounded-xl border border-border bg-surface/60 p-2" aria-live="polite">
                  {GENERATION_STEPS.map((s, i) => {
                    const status = i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
                    return (
                      <li
                        key={s}
                        className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5", status === "active" && "bg-surface-2")}
                      >
                        <span className="grid h-5 w-5 shrink-0 place-items-center">
                          {status === "done" && <Check className="h-4 w-4 text-success" />}
                          {status === "active" && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                          {status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />}
                        </span>
                        <span className="flex-1">
                          <span className={cn("block text-sm", status === "pending" ? "text-muted" : "text-foreground")}>
                            {t.steps[s]}
                          </span>
                          {status === "active" && s === "databases" && state.db && (
                            <span className="block font-mono text-[0.72rem] text-muted-foreground">
                              {fill(t.creating, { db: state.db })}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {state.kind === "error" && (
                <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-[0.8125rem] leading-relaxed text-danger">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {state.notConnected
                        ? t.notConnected
                        : state.message
                          ? fill(t.failed, { message: state.message })
                          : t.failedGeneric}
                    </span>
                  </p>
                  {state.wrote && <p className="mt-2 text-danger/80">{t.partial}</p>}
                  <div className="mt-4 flex gap-3">
                    {!state.notConnected && (
                    <button
                      type="button"
                      onClick={build}
                      className="rounded-md border border-danger/30 px-3 py-1.5 font-medium hover:bg-danger/10"
                    >
                      {t.retry}
                    </button>
                    )}
                    <Link href="/settings#connections" className="px-1 py-1.5 underline-offset-4 hover:underline">
                      {t.toSettings}
                    </Link>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
