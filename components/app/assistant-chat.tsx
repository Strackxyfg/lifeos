"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, ArrowUp, Mic, Square, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { useMessages, useLocale } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { useDictation } from "@/components/brain/use-dictation";
import { toast } from "@/components/ui/toaster";

type Source = { id: string; t: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };

/** The notes behind an answer, from the response header. Never throws. */
function readSources(res: Response): Source[] {
  try {
    const raw = res.headers.get("X-Brain-Sources");
    if (!raw) return [];
    const list = JSON.parse(decodeURIComponent(raw)) as unknown;
    return Array.isArray(list)
      ? list.filter((s): s is Source => !!s && typeof s.id === "string" && typeof s.t === "string").slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export function AssistantChat({ firstName = "there" }: { firstName?: string }) {
  const m = useMessages();
  const locale = useLocale();
  const [messages, setMessages] = useState<Msg[]>(() => [
    { role: "assistant", content: fill(m.assistant.seed, { name: firstName }) },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = () =>
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || thinking) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setThinking(true);
    scrollToEnd();

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only what the model needs: the sources shown under an answer are
        // for the reader, not part of the conversation.
        body: JSON.stringify({ messages: next.map(({ role, content: c }) => ({ role, content: c })), locale }),
      });
      if (!res.ok || !res.body) throw new Error("no stream");
      const sources = readSources(res);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let started = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (!started) {
          started = true;
          setThinking(false);
          setMessages((cur) => [...cur, { role: "assistant", content: acc, sources }]);
        } else {
          setMessages((cur) => {
            const copy = [...cur];
            copy[copy.length - 1] = { role: "assistant", content: acc, sources };
            return copy;
          });
        }
        scrollToEnd();
      }
      if (!started) setThinking(false);
    } catch {
      setThinking(false);
      // Said "Thinking…" — the one thing it was no longer doing.
      setMessages((cur) => [...cur, { role: "assistant", content: m.assistant.failed }]);
    }
  };

  // The microphone used to be a button with nothing behind it.
  const dictation = useDictation({
    locale,
    onText: (text, final) => {
      setInput(text);
      if (final && text) void send(text);
    },
    onError: (e) => toast(e === "denied" ? m.brain.voiceDenied : m.brain.voiceError, "error"),
  });

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col rounded-xl border border-border bg-surface">
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease }}
            className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}
          >
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                msg.role === "assistant" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted-foreground"
              )}
            >
              {msg.role === "assistant" ? <Sparkles className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </span>
            <div className={cn("max-w-[80%]", msg.role === "user" && "flex justify-end")}>
              <div
                className={cn(
                  "whitespace-pre-wrap rounded-xl px-4 py-3 text-[0.9375rem] leading-relaxed",
                  msg.role === "assistant" ? "bg-surface-2 text-foreground/90" : "bg-foreground text-background"
                )}
              >
                {msg.content}
              </div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.7rem] text-muted">{m.assistant.sources}</span>
                  {msg.sources.map((s) => (
                    <Link
                      key={s.id}
                      href={`/brain?note=${encodeURIComponent(s.id)}`}
                      className="max-w-[16rem] truncate rounded-full border border-border px-2 py-0.5 text-[0.72rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      {s.t}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {thinking && (
          <div className="flex gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="flex items-center gap-1 rounded-xl bg-surface-2 px-4 py-4">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-6 pb-3">
          {m.assistant.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-1.5 focus-within:border-border-strong">
          {dictation.supported && (
            <button
              type="button"
              onClick={dictation.listening ? dictation.stop : dictation.start}
              aria-label={dictation.listening ? m.brain.voiceStop : m.brain.voiceStart}
              aria-pressed={dictation.listening}
              title={m.brain.voiceDisclosure}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md transition-colors",
                dictation.listening ? "bg-danger/15 text-danger" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {dictation.listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={dictation.listening ? m.brain.voiceListening : m.assistant.placeholder}
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
