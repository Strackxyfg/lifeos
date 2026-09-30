"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, BellPlus, Check, Loader2, MessageCircle, NotebookPen, RotateCcw, Target } from "lucide-react";
import { acceptDoubleAction, type Accepted } from "@/app/actions/self";
import { parseDoubleActions, visibleAnswer, type DoubleAction } from "@/lib/self/double";
import { toast } from "@/components/ui/toaster";
import { fill } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatWhen } from "./advice-list";

interface Turn {
  role: "user" | "assistant";
  content: string;
  actions?: DoubleAction[];
  sources?: { id: string; t: string }[];
  /** Index of each action accepted. */
  accepted?: number[];
}

const decode = <T,>(header: string | null, fallback: T): T => {
  if (!header) return fallback;
  try {
    return JSON.parse(decodeURIComponent(header)) as T;
  } catch {
    return fallback;
  }
};

export function DoubleChat({ aiEnabled, zone, onAccepted }: { aiEnabled: boolean; zone: string; onAccepted: (a: Accepted) => void }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.talk;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scroll = () => requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming) return;
    setDraft("");
    const history = [...turns.map(({ role, content }) => ({ role, content })), { role: "user" as const, content: q }];
    setTurns((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setStreaming(true);
    scroll();
    let raw = "";
    let refs: Record<string, string> = {};
    let sources: { id: string; t: string }[] = [];
    try {
      const res = await fetch("/api/self/double", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, locale, zone }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      refs = decode(res.headers.get("X-Double-Goals"), {});
      sources = decode(res.headers.get("X-Brain-Sources"), []);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const visible = visibleAnswer(raw);
        setTurns((prev) => prev.map((x, i) => (i === prev.length - 1 ? { ...x, content: visible } : x)));
      }
      raw += decoder.decode();
    } catch {
      raw = raw || t.failed;
    }
    const actions = parseDoubleActions(raw, new Map(Object.entries(refs)));
    setTurns((prev) =>
      prev.map((x, i) => (i === prev.length - 1 ? { ...x, content: visibleAnswer(raw) || t.failed, actions, sources, accepted: [] } : x))
    );
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

  const icon = (a: DoubleAction) => (a.type === "step" ? Target : a.type === "reminder" ? BellPlus : NotebookPen);
  const label = (a: DoubleAction) => (a.type === "step" ? t.step : a.type === "reminder" ? t.reminder : t.note);

  return (
    <section aria-labelledby="talk-title" className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="talk-title" className="flex items-center gap-2 text-[0.95rem] font-medium">
          <MessageCircle className="h-4 w-4 text-accent" /> {t.title}
        </h2>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns([])}
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
            <div ref={listRef} className="mt-4 flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
              {turns.map((turn, ti) =>
                turn.role === "user" ? (
                  <div key={ti} className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-surface-2 px-3 py-2 text-[0.86rem] leading-relaxed">
                    <span className="sr-only">{t.you}: </span>
                    {turn.content}
                  </div>
                ) : (
                  <div key={ti} className="max-w-[92%]">
                    <p className="sr-only">{t.double}:</p>
                    {turn.content ? (
                      <div className="whitespace-pre-wrap text-[0.88rem] leading-relaxed">{turn.content}</div>
                    ) : (
                      <p className="flex items-center gap-2 text-[0.82rem] text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> {t.thinking}
                      </p>
                    )}
                    {turn.actions && turn.actions.length > 0 && (
                      <div className="mt-2.5 rounded-lg border border-accent/25 bg-accent/5 p-2.5">
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
                                  disabled={accepted || busy === `${ti}:${ai}`}
                                  onClick={() => void accept(ti, ai, a)}
                                  className={cn(
                                    "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[0.72rem] transition-colors",
                                    accepted ? "text-success" : "border border-border hover:border-border-strong"
                                  )}
                                >
                                  {busy === `${ti}:${ai}` ? <Loader2 className="h-3 w-3 animate-spin" /> : accepted ? <Check className="h-3 w-3" /> : null}
                                  {accepted ? t.accepted : label(a)}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {turn.sources && turn.sources.length > 0 && (
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                        {t.sources}
                        {turn.sources.map((s) => (
                          <Link key={s.id} href={`/brain?note=${encodeURIComponent(s.id)}`} className="rounded-full border border-border px-2 py-0.5 hover:text-foreground">
                            {s.t}
                          </Link>
                        ))}
                      </p>
                    )}
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
                  className="rounded-full border border-border px-2.5 py-1 text-[0.76rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
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
              className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
            >
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </form>
          <p className="mt-2 text-[0.68rem] text-muted">{t.notTherapist}</p>
        </>
      )}
    </section>
  );
}
