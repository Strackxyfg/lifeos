"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, RotateCw, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { useMessages, useLocale } from "@/lib/i18n/client";
import type { Insight, InsightKind } from "@/lib/ai/insights";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

/**
 * The weekly review / daily summary surface.
 * Both are generated server-side from a real workspace snapshot; the badge
 * shows whether the text came from the model or the computed fallback.
 */
export function AiInsights() {
  const m = useMessages();
  const locale = useLocale();
  const [kind, setKind] = useState<InsightKind>("weekly");
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Guards against a slow earlier request overwriting a newer one.
  const reqId = useRef(0);

  const load = useCallback(
    async (k: InsightKind) => {
      const id = ++reqId.current;
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: k, locale }),
        });
        const data = (await res.json()) as Insight;
        if (id !== reqId.current) return;
        setInsight(data);
      } catch {
        if (id !== reqId.current) return;
        setFailed(true);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [locale]
  );

  useEffect(() => {
    load(kind);
  }, [kind, load]);

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium tracking-tight">
          <Sparkles className="h-4 w-4 text-accent" />
          {kind === "weekly" ? m.dashboard.weeklyReview : m.dashboard.dailySummary}
        </span>
        <Segmented<InsightKind>
          value={kind}
          onChange={setKind}
          layoutId="insight-kind"
          options={[
            { value: "daily", label: m.dashboard.daily },
            { value: "weekly", label: m.dashboard.weekly },
          ]}
        />
      </div>

      <div className="flex-1 p-5">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" exit={{ opacity: 0 }} className="space-y-3">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-11/12" />
              <div className="mt-5 space-y-2">
                <div className="skeleton h-3 w-4/5" />
                <div className="skeleton h-3 w-3/5" />
                <div className="skeleton h-3 w-2/3" />
              </div>
              <p className="pt-1 text-[0.72rem] text-muted">{m.dashboard.generating}</p>
            </motion.div>
          ) : failed || !insight ? (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="text-sm text-muted-foreground">{m.dashboard.insightFailed}</p>
            </motion.div>
          ) : (
            <motion.div
              key={`${kind}-${insight.generatedAt}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.24, ease }}
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-[0.95rem] font-medium leading-snug tracking-tight">
                  {insight.headline}
                </h4>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 py-0.5 text-[0.6rem] font-medium",
                    insight.source === "ai"
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-border bg-surface-2 text-muted-foreground"
                  )}
                >
                  {insight.source === "ai" ? "AI" : m.dashboard.computedBadge}
                </span>
              </div>

              <p className="mt-2 text-[0.9rem] leading-relaxed text-foreground/85">{insight.body}</p>

              <ul className="mt-4 space-y-2 text-[0.8125rem] text-muted-foreground">
                {insight.actions.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent">→</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 border-t border-border p-3">
        <button
          onClick={() => load(kind)}
          disabled={loading}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RotateCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {m.dashboard.regenerate}
        </button>
        <a
          href="/assistant"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-surface-2 py-2.5 text-sm transition-colors hover:bg-surface-2/70"
        >
          {m.dashboard.askAssistant} <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </Card>
  );
}
