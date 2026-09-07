"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Bot, User, ArrowUp, Loader2, Clock, AlertTriangle } from "lucide-react";
import { sendAgentMessage } from "@/app/actions/agent";
import type { AgentMessage } from "@/lib/agent/store";
import { toast } from "@/components/ui/toaster";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

/**
 * Messaging with the remote agent.
 *
 * Replies don't arrive over a socket: the runner polls its inbox on its own
 * VPS, so an answer appears on its next cycle. The UI says so and polls for
 * new messages rather than pretending the exchange is instant.
 */
export function AgentChat({
  messages,
  runnerOnline,
}: {
  messages: AgentMessage[];
  runnerOnline: boolean;
}) {
  const m = useMessages();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const awaiting = messages.some((x) => x.role === "user" && x.status !== "handled");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  // While a reply is outstanding, refresh so the answer shows up on arrival.
  useEffect(() => {
    if (!awaiting) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [awaiting, router]);

  const send = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    start(async () => {
      const res = await sendAgentMessage(text);
      if (!res.ok) {
        setDraft(text);
        toast(res.error, "error");
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className="flex h-[26rem] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">{m.agent.chatEmpty}</p>
        )}

        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease }}
            className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}
          >
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                msg.role === "agent" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted-foreground"
              )}
            >
              {msg.role === "agent" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </span>
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-[0.9rem] leading-relaxed",
                msg.role === "agent" ? "bg-surface-2 text-foreground/90" : "bg-foreground text-background"
              )}
            >
              {msg.content}
              {msg.role === "user" && msg.status !== "handled" && (
                <span className="mt-1.5 flex items-center gap-1 text-[0.68rem] opacity-70">
                  {msg.status === "failed" ? (
                    <><AlertTriangle className="h-3 w-3" /> {m.agent.chatFailed}</>
                  ) : (
                    <><Clock className="h-3 w-3" /> {m.agent.chatWaiting}</>
                  )}
                </span>
              )}
            </div>
          </motion.div>
        ))}
        <div ref={endRef} />
      </div>

      {!runnerOnline && (
        <p className="mx-5 mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[0.72rem] leading-relaxed text-warning">
          {m.agent.chatNoRunner}
        </p>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-1.5 focus-within:border-border-strong">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder={m.agent.chatPlaceholder}
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            onClick={send}
            disabled={!draft.trim() || pending}
            aria-label={m.agent.chatSend}
            className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
