"use client";

import Link from "next/link";
import { BellPlus, Check, Loader2, NotebookPen, Target } from "lucide-react";
import type { DoubleAction } from "@/lib/self/double";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { CareCard } from "./care-card";
import type { DoubleTurn } from "./double-stream";

/**
 * An answer of the double: its words (streaming in, or a quiet "thinking"
 * until the first one), who to call when the exchange says so, the actions
 * it proposes — each run only once accepted — and the notes it drew on.
 */
export function DoubleReply({
  turn,
  busy,
  onAccept,
}: {
  turn: DoubleTurn;
  /** Index of the action being accepted, if any. */
  busy: number | null;
  onAccept: (index: number, action: DoubleAction) => void;
}) {
  const t = useMessages().self.talk;
  const icon = (a: DoubleAction) => (a.type === "step" ? Target : a.type === "reminder" ? BellPlus : NotebookPen);
  const label = (a: DoubleAction) => (a.type === "step" ? t.step : a.type === "reminder" ? t.reminder : t.note);
  return (
    <div className="flex flex-col gap-2.5">
      {turn.care === "crisis" && <CareCard />}
      {turn.content ? (
        <div className="whitespace-pre-wrap text-[0.88rem] leading-relaxed">{turn.content}</div>
      ) : (
        <p className="flex items-center gap-2 text-[0.82rem] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> {t.thinking}
        </p>
      )}
      {turn.actions && turn.actions.length > 0 && (
        <div className="rounded-lg border border-accent/25 bg-accent/5 p-2.5">
          <p className="text-[0.7rem] font-medium uppercase tracking-wider text-accent">{t.proposes}</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {turn.actions.map((a, ai) => {
              const Icon = icon(a);
              const accepted = turn.accepted?.includes(ai);
              return (
                <li key={ai} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-[0.8rem] leading-snug">
                    {a.title}
                    {a.type === "reminder" && <span className="text-muted-foreground"> — {a.when}</span>}
                  </span>
                  <button
                    type="button"
                    disabled={accepted || busy === ai}
                    onClick={() => onAccept(ai, a)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[0.72rem] transition-colors [@media(pointer:coarse)]:py-1.5",
                      accepted ? "text-success" : "border border-border hover:border-border-strong"
                    )}
                  >
                    {busy === ai ? <Loader2 className="h-3 w-3 animate-spin" /> : accepted ? <Check className="h-3 w-3" /> : null}
                    {accepted ? t.accepted : label(a)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {turn.sources && turn.sources.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[0.7rem] text-muted-foreground">
          {t.sources}
          {turn.sources.map((s) => (
            <Link key={s.id} href={`/brain?note=${encodeURIComponent(s.id)}`} className="rounded-full border border-border px-2 py-0.5 hover:text-foreground [@media(pointer:coarse)]:py-1.5">
              {s.t}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}
