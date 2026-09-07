"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, ArrowUp, Mic, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { useMessages, useLocale } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";

type Msg = { role: "user" | "assistant"; content: string };

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
        body: JSON.stringify({ messages: next, locale }),
      });
      if (!res.body) throw new Error("no stream");

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
          setMessages((cur) => [...cur, { role: "assistant", content: acc }]);
        } else {
          setMessages((cur) => {
            const copy = [...cur];
            copy[copy.length - 1] = { role: "assistant", content: acc };
            return copy;
          });
        }
        scrollToEnd();
      }
      if (!started) setThinking(false);
    } catch {
      setThinking(false);
      setMessages((cur) => [...cur, { role: "assistant", content: m.assistant.thinking }]);
    }
  };

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
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-3 text-[0.9375rem] leading-relaxed",
                msg.role === "assistant" ? "bg-surface-2 text-foreground/90" : "bg-foreground text-background"
              )}
            >
              {msg.content}
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
          <button className="text-muted-foreground hover:text-foreground" aria-label="Voice input">
            <Mic className="h-4 w-4" />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder={m.assistant.placeholder}
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
