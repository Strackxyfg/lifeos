"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { setAutonomy } from "@/app/actions/agent";
import { AUTONOMY_ORDER, type AutonomyLevel } from "@/lib/agent/policy";
import { toast } from "@/components/ui/toaster";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const KEY = {
  observe: "autonomyObserve",
  assist: "autonomyAssist",
  act: "autonomyAct",
  extend: "autonomyExtend",
} as const;

/**
 * The user picks their own autonomy level.
 *
 * The assessment recommends; the account owner decides. Choosing above the
 * recommendation is allowed but flagged — and it never touches the hard rules:
 * high-risk still needs approval, forbidden is still forbidden.
 */
export function AutonomyPicker({
  current,
  recommended,
}: {
  current: AutonomyLevel;
  recommended: string | null;
}) {
  const m = useMessages();
  const router = useRouter();
  const [value, setValue] = useState<AutonomyLevel>(current);
  const [pending, start] = useTransition();

  const recIndex = recommended ? AUTONOMY_ORDER.indexOf(recommended as AutonomyLevel) : -1;
  const aboveRecommendation = recIndex >= 0 && AUTONOMY_ORDER.indexOf(value) > recIndex;

  const choose = (level: AutonomyLevel) => {
    if (level === value || pending) return;
    const previous = value;
    setValue(level);
    start(async () => {
      const res = await setAutonomy(level);
      if (!res.ok) {
        setValue(previous);
        toast(res.error, "error");
      } else {
        toast(m.agent.autonomySaved);
        router.refresh();
      }
    });
  };

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[0.75rem] text-muted-foreground">{m.agent.autonomyChoose}</p>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid gap-2">
        {AUTONOMY_ORDER.map((level) => {
          const active = value === level;
          const isRecommended = recommended === level;
          return (
            <button
              key={level}
              onClick={() => choose(level)}
              disabled={pending}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-all duration-200",
                active
                  ? "border-accent/50 bg-accent/10"
                  : "border-border bg-surface-2/40 hover:border-border-strong"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                  active ? "border-accent bg-accent text-accent-foreground" : "border-border-strong"
                )}
              >
                {active && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[0.875rem] font-medium capitalize">
                  {level}
                  {isRecommended && (
                    <span className="flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.62rem] font-normal text-accent">
                      <Sparkles className="h-2.5 w-2.5" />
                      {m.agent.recommended}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[0.72rem] leading-relaxed text-muted-foreground">
                  {m.agent[KEY[level]]}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {aboveRecommendation && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[0.72rem] leading-relaxed text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {m.agent.aboveRecommendation}
        </p>
      )}

      <p className="mt-3 text-[0.7rem] leading-relaxed text-muted">{m.agent.autonomyNote}</p>
    </div>
  );
}
