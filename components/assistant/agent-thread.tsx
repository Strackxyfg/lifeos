"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUp, Check, CircleSlash, Loader2, Mic, Plus, ShieldAlert, Sparkles, Square, User, X, AlertTriangle, Gauge, Hand,
} from "lucide-react";
import type { AgentMessage } from "@/lib/ai/types";
import type { AgentEvent } from "@/lib/agent/loop";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { SpeakButton } from "@/components/voice/speak-button";
import { useDictation } from "@/components/brain/use-dictation";
import { toast } from "@/components/ui/toaster";
import {
  applyEvent, decide, emptyAgentTurn, pendingApproval, sourcesOf, stepLabel, textOf, type AgentTurn, type Segment, type Turn,
} from "./agent-view";
import { RichText } from "./rich-text";

/**
 * The agent in the app: a conversation where it looks things up, acts, and
 * stops for the owner's approval on what leaves LifeOS.
 *
 * The conversation (`transcript`, the server's own record of it, models'
 * reasoning included) lives in this tab — sessionStorage, so a reload keeps
 * it and closing the tab forgets it. What is shown (`turns`) is built from
 * the stream of events and kept beside it.
 */

const STORE_KEY = "lifeos:agent-thread";
const PROVIDER_LABEL: Record<string, string> = {
  groq: "Groq", mistral: "Mistral AI", cerebras: "Cerebras", deepseek: "DeepSeek", openrouter: "OpenRouter", anthropic: "Anthropic", openai: "OpenAI",
};

interface Saved {
  transcript: AgentMessage[];
  turns: Turn[];
  route?: string;
}

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    return Array.isArray(v.transcript) && Array.isArray(v.turns) ? v : null;
  } catch {
    return null;
  }
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function AgentThread({ firstName, business }: { firstName: string; business: boolean }) {
  const m = useMessages();
  const t = m.agentChat;
  const locale = useLocale();
  const [transcript, setTranscript] = useState<AgentMessage[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [route, setRoute] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [strict, setStrict] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    const saved = load();
    if (saved) {
      setTranscript(saved.transcript);
      // A turn cut off mid-stream by a reload has nothing more coming.
      setTurns(saved.turns.map((x) => (x.role === "agent" && !x.stop && !x.error && !pendingApprovalIn(x) ? { ...x, error: "aborted" } : x)));
      setRoute(saved.route);
    }
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current || busy) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ transcript, turns, route } satisfies Saved));
    } catch {
      /* full or unavailable: the conversation still works, it just won't survive a reload */
    }
  }, [transcript, turns, route, busy]);

  const scrollToEnd = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 30);

  /** Applies a change to the last turn, which is the agent's. */
  const onAgent = useCallback((f: (turn: AgentTurn) => AgentTurn) => {
    setTurns((cur) => {
      const last = cur[cur.length - 1];
      if (!last || last.role !== "agent") return cur;
      return [...cur.slice(0, -1), f(last)];
    });
  }, []);

  const run = useCallback(
    async (body: { input?: string; decision?: { id: string; approve: boolean } }, history: AgentMessage[]) => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      scrollToEnd();
      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            ...body,
            locale,
            zone: browserZone(),
            effort: deep ? "high" : "medium",
            strict,
            route,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
          onAgent((x) => ({ ...x, error: err === "quota" || err === "no_ai" || err === "too_long" ? err : "failed" }));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let e: AgentEvent;
            try {
              e = JSON.parse(line) as AgentEvent;
            } catch {
              continue;
            }
            if (e.t === "transcript") setTranscript(e.messages);
            else {
              if (e.t === "model") setRoute(e.route);
              onAgent((x) => applyEvent(x, e));
              if (e.t === "text" || e.t === "step" || e.t === "approval") scrollToEnd();
            }
          }
        }
      } catch {
        onAgent((x) => ({ ...x, error: ctrl.signal.aborted ? "aborted" : "network" }));
      } finally {
        abort.current = null;
        setBusy(false);
      }
    },
    [locale, deep, strict, route, onAgent]
  );

  const send = (text: string) => {
    const content = text.trim();
    if (!content || busy || pendingApproval(turns)) return;
    setInput("");
    setTurns((cur) => [...cur, { role: "user", text: content }, emptyAgentTurn()]);
    void run({ input: content }, transcript);
  };

  const answer = (id: string, approve: boolean) => {
    if (busy) return;
    onAgent((x) => decide(x, id, approve));
    void run({ decision: { id, approve } }, transcript);
  };

  const reset = () => {
    abort.current?.abort();
    setTranscript([]);
    setTurns([]);
    setRoute(undefined);
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* nothing to forget */
    }
  };

  const dictation = useDictation({
    locale,
    onText: (text, final) => {
      setInput(text);
      if (final && text) send(text);
    },
    onError: (e) => toast(e === "denied" ? m.brain.voiceDenied : m.brain.voiceError, "error"),
  });

  const waiting = pendingApproval(turns);
  const suggestions = business ? t.suggestionsBusiness : t.suggestions;

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[24rem] flex-col rounded-xl border border-border bg-surface lg:h-[calc(100dvh-14rem)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Toggle on={deep} onClick={() => setDeep((v) => !v)} icon={<Gauge className="h-3.5 w-3.5" aria-hidden />} label={t.deep} short={t.deepShort} hint={t.deepHint} />
          <Toggle on={strict} onClick={() => setStrict((v) => !v)} icon={<Hand className="h-3.5 w-3.5" aria-hidden />} label={t.strict} short={t.strictShort} hint={t.strictHint} />
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[0.78rem] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">{t.newChat}</span>
            <span className="sr-only sm:hidden">{t.newChat}</span>
          </button>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6" role="log" aria-live="polite" aria-busy={busy}>
        <AgentBubble>
          <p className="whitespace-pre-wrap rounded-xl bg-surface-2 px-4 py-3 text-[0.9375rem] leading-relaxed text-foreground/90">
            {fill(t.seed, { name: firstName === "there" ? "" : firstName, business: business ? t.seedBusiness : "" }).replace(/^(Hi|Bonjour) \./, "$1.")}
          </p>
        </AgentBubble>

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className="flex flex-row-reverse gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
                <User className="h-4 w-4" aria-hidden />
              </span>
              <p className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-foreground px-4 py-3 text-[0.9375rem] leading-relaxed text-background">{turn.text}</p>
            </motion.div>
          ) : (
            <AgentTurnView key={i} turn={turn} live={busy && i === turns.length - 1} onDecide={answer} disabled={busy} />
          )
        )}
        <div ref={endRef} />
      </div>

      {turns.length === 0 && (
        // One scrolling row on a phone, so the conversation keeps the room; wrapped on wider screens.
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:flex-wrap sm:px-6">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="shrink-0 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[0.8125rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground sm:shrink sm:whitespace-normal"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-1.5 focus-within:border-border-strong">
          {dictation.supported && (
            <button
              type="button"
              onClick={dictation.listening ? dictation.stop : dictation.start}
              aria-label={dictation.listening ? m.brain.voiceStop : m.brain.voiceStart}
              aria-pressed={dictation.listening}
              title={m.brain.voiceDisclosure}
              className={cn(
                "mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
                dictation.listening ? "bg-danger/15 text-danger" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {dictation.listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={dictation.listening ? m.brain.voiceListening : t.placeholder}
            aria-label={t.placeholder}
            disabled={!!waiting}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-base leading-snug outline-none placeholder:text-muted disabled:opacity-60 sm:text-sm"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-foreground transition-colors hover:bg-surface-2"
              aria-label={t.stop}
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => send(input)}
              disabled={!input.trim() || !!waiting}
              className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
              aria-label={t.send}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const pendingApprovalIn = (turn: AgentTurn) => turn.segments.some((s) => s.kind === "approval" && s.status === "pending");

function Toggle({ on, onClick, icon, label, short, hint }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; short: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={hint}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75rem] transition-colors",
        on ? "border-accent/50 bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function AgentBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 max-w-[85%] flex-1 space-y-2">{children}</div>
    </div>
  );
}

function AgentTurnView({ turn, live, onDecide, disabled }: { turn: AgentTurn; live: boolean; onDecide: (id: string, approve: boolean) => void; disabled: boolean }) {
  const m = useMessages();
  const t = m.agentChat;
  const locale = useLocale();
  const sources = sourcesOf(turn);
  const text = textOf(turn);
  const working = live && !turn.segments.some((s) => s.kind === "approval" && s.status === "pending");
  const notice =
    turn.error && turn.error !== "aborted"
      ? (t.errors as Record<string, string>)[turn.error] ?? t.errors.failed
      : turn.stop === "limit"
        ? fill(t.errors.limit, { n: turn.steps })
        : turn.stop === "max_tokens"
          ? t.errors.max_tokens
          : turn.stop === "refusal"
            ? t.errors.refusal
            : turn.error === "aborted"
              ? t.errors.aborted
              : null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }}>
      <AgentBubble>
        {turn.segments.map((s, i) => (
          <SegmentView key={s.kind === "text" ? `t${i}` : s.id + s.kind} segment={s} onDecide={onDecide} disabled={disabled} />
        ))}
        {working && (
          <p className="flex items-center gap-2 px-1 text-[0.8125rem] text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden /> {t.working}
          </p>
        )}
        {notice && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[0.8125rem] text-foreground/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /> {notice}
          </p>
        )}
        {!live && (sources.length > 0 || turn.model || text) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
            {sources.length > 0 && <span className="text-[0.7rem] text-muted">{t.sources}</span>}
            {sources.map((s) => (
              <Link
                key={s.id}
                href={`/brain?note=${encodeURIComponent(s.id)}`}
                className="max-w-[14rem] truncate rounded-full border border-border px-2 py-0.5 text-[0.72rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {s.t}
              </Link>
            ))}
            {text && <SpeakButton text={text} compact className="h-6 w-6 justify-center" />}
            {turn.model && (
              <span className="text-[0.7rem] text-muted" title={turn.steps ? plural(locale, turn.steps, t.steps) : undefined}>
                {fill(t.model, { model: `${turn.model} · ${PROVIDER_LABEL[turn.provider ?? ""] ?? turn.provider ?? ""}` })}
              </span>
            )}
          </div>
        )}
      </AgentBubble>
    </motion.div>
  );
}

function SegmentView({ segment: s, onDecide, disabled }: { segment: Segment; onDecide: (id: string, approve: boolean) => void; disabled: boolean }) {
  const m = useMessages();
  const t = m.agentChat;
  if (s.kind === "text") {
    if (!s.text.trim()) return null;
    return <RichText text={s.text.trim()} className="rounded-xl bg-surface-2 px-4 py-3 text-[0.9375rem] leading-relaxed text-foreground/90" />;
  }
  const label = stepLabel(t.tools, s.name, s.args);
  if (s.kind === "step") {
    const icon =
      s.state === "running" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
      ) : s.state === "done" ? (
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      ) : s.state === "declined" || s.state === "denied" ? (
        <CircleSlash className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      ) : (
        <X className="h-3.5 w-3.5 text-danger" aria-hidden />
      );
    return (
      <div className="flex items-start gap-2 px-1 text-[0.8125rem] text-muted-foreground">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0">
          <span className={cn(s.state === "running" && "text-foreground/90")}>{label}</span>
          {s.state !== "running" && s.state !== "done" && <span className="text-muted"> · {t.state[s.state]}</span>}
          {s.state !== "running" && s.state !== "done" && s.summary && <span className="block text-[0.75rem] text-muted">{s.summary}</span>}
          {s.flagged && (
            <span className="mt-0.5 flex items-start gap-1 text-[0.75rem] text-warning">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {t.injection}
            </span>
          )}
        </span>
      </div>
    );
  }
  return <ApprovalCard card={s} label={label} onDecide={onDecide} disabled={disabled} />;
}

function ApprovalCard({
  card,
  label,
  onDecide,
  disabled,
}: {
  card: Extract<Segment, { kind: "approval" }>;
  label: string;
  onDecide: (id: string, approve: boolean) => void;
  disabled: boolean;
}) {
  const m = useMessages();
  const t = m.agentChat;
  const fields = Object.entries(card.args).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  const long = (k: string) => k === "body" || k === "detail";
  return (
    <div className={cn("rounded-xl border p-3.5", card.status === "pending" ? "border-warning/50 bg-warning/5" : "border-border bg-surface-2/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
        <span className="text-[0.8125rem] font-medium">{t.approval.title}</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-muted-foreground">{t.approval.tier[card.tier]}</span>
      </div>
      <p className="mt-2 text-sm">{label}</p>
      {fields.length > 0 && (
        <dl className="mt-2 space-y-1.5 text-[0.8125rem]">
          {fields.map(([k, v]) => (
            <div key={k} className={cn(long(k) ? "block" : "flex gap-2")}>
              <dt className="shrink-0 text-muted-foreground">{(t.fields as Record<string, string>)[k] ?? k}</dt>
              <dd
                className={cn(
                  "min-w-0 break-words",
                  long(k) && "mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2"
                )}
              >
                {String(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {card.status === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecide(card.id, true)}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[0.8125rem] font-medium text-background disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" aria-hidden /> {t.approval.approve}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecide(card.id, false)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-[0.8125rem] text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> {t.approval.decline}
          </button>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          {card.status === "approved" ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <CircleSlash className="h-3.5 w-3.5" aria-hidden />}
          {card.status === "approved" ? t.approval.approved : t.approval.declined}
        </p>
      )}
    </div>
  );
}

