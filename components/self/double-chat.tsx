"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, LifeBuoy, Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { acceptDoubleAction, type Accepted } from "@/app/actions/self";
import type { DoubleAction } from "@/lib/self/double";
import { toast } from "@/components/ui/toaster";
import { fill } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { formatWhen } from "./advice-list";
import { CareCard } from "./care-card";
import { DoubleReply } from "./double-reply";
import { streamDouble, type DoubleTurn } from "./double-stream";

export interface DoubleChatHandle {
  /** Brings the conversation into view and puts the cursor in it. */
  focus(): void;
}

/**
 * Talking with the double. The thread is held by the page, so an exchange
 * begun on the question of the day carries on here.
 */
export const DoubleChat = forwardRef<
  DoubleChatHandle,
  {
    aiEnabled: boolean;
    zone: string;
    turns: DoubleTurn[];
    setTurns: (update: (prev: DoubleTurn[]) => DoubleTurn[]) => void;
    onAccepted: (a: Accepted) => void;
  }
>(function DoubleChat({ aiEnabled, zone, turns, setTurns, onAccepted }, ref) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.talk;
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const section = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const scroll = () => setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 0);

  useImperativeHandle(ref, () => ({
    focus() {
      section.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      // After the scroll has started: focusing first would jump the page.
      setTimeout(() => input.current?.focus({ preventScroll: true }), 350);
      scroll();
    },
  }));

  // The field grows with what is typed, up to its maximum.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming) return;
    setDraft("");
    const history: DoubleTurn[] = [...turns.map(({ role, content, question }) => ({ role, content, question })), { role: "user", content: q }];
    setTurns((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setStreaming(true);
    scroll();
    const patchLast = (patch: Partial<DoubleTurn>) => setTurns((prev) => prev.map((x, i) => (i === prev.length - 1 ? { ...x, ...patch } : x)));
    const res = await streamDouble({
      turns: history,
      mode: "chat",
      locale,
      zone,
      questionLabel: t.questionOfDay,
      onText: (content) => patchLast({ content }),
      onCare: (care) => patchLast({ care }),
    });
    patchLast({ content: res.text || t.failed, actions: res.actions, sources: res.sources, accepted: [], care: res.care });
    setStreaming(false);
    scroll();
  }

  async function accept(turn: number, index: number, action: DoubleAction) {
    const key = `${turn}:${index}`;
    setBusy(key);
    const res = await acceptDoubleAction(action, { zone, locale }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      if (res?.code === "invalid" && action.type === "reminder") return void toast(fill(t.whenUnclear, { when: action.when }), "error");
      return void toast(m.self.errors[res?.code ?? "failed"], "error");
    }
    onAccepted(res.data);
    setTurns((prev) => prev.map((x, i) => (i === turn ? { ...x, accepted: [...(x.accepted ?? []), index] } : x)));
    toast(res.data.reminder ? fill(m.self.advice.reminded, { when: formatWhen(res.data.reminder.dueAt, locale, zone) }) : t.accepted);
  }

  return (
    <section ref={section} aria-labelledby="talk-title" className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="talk-title" className="flex items-center gap-2 text-[0.95rem] font-medium">
          <MessageCircle className="h-4 w-4 text-accent" /> {t.title}
        </h2>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns(() => [])}
            disabled={streaming}
            className="inline-flex items-center gap-1 text-[0.74rem] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" /> {t.newThread}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[0.74rem] text-muted-foreground">{t.hint}</p>

      {!aiEnabled ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-[0.82rem] text-muted-foreground">{t.noAi}</p>
      ) : (
        <>
          {turns.length > 0 && (
            <div ref={listRef} className="mt-4 flex max-h-[32rem] flex-col gap-3.5 overflow-y-auto overscroll-contain pr-1" aria-live="polite">
              {turns.map((turn, ti) =>
                turn.role === "user" ? (
                  <div key={ti} className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-surface-2 px-3 py-2 text-[0.86rem] leading-relaxed">
                    <span className="sr-only">{t.you}: </span>
                    {turn.question && (
                      <span className="mb-1 block text-[0.72rem] text-muted-foreground">
                        {t.questionOfDay} — {turn.question}
                      </span>
                    )}
                    <span className="whitespace-pre-wrap">{turn.content}</span>
                  </div>
                ) : (
                  <div key={ti} className="max-w-[94%]">
                    <p className="sr-only">{t.double}:</p>
                    <DoubleReply
                      turn={turn}
                      busy={busy?.startsWith(`${ti}:`) ? Number(busy.split(":")[1]) : null}
                      onAccept={(index, action) => void accept(ti, index, action)}
                    />
                  </div>
                )
              )}
            </div>
          )}

          {turns.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-[0.76rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground [@media(pointer:coarse)]:py-1.5"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-3 flex items-end gap-2 rounded-lg border border-border bg-surface-2/30 px-2.5 py-1.5 focus-within:border-border-strong"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              maxLength={1500}
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-[0.86rem] outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!draft.trim() || streaming}
              aria-label={t.send}
              className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
            >
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </form>
        </>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted">
        <span>{t.notTherapist}</span>
        <button type="button" onClick={() => setHelp((v) => !v)} aria-expanded={help} className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          <LifeBuoy className="h-3 w-3" aria-hidden /> {t.talkNow}
        </button>
      </p>
      {help && (
        <div className="mt-2.5">
          <CareCard onClose={() => setHelp(false)} />
        </div>
      )}
    </section>
  );
});
