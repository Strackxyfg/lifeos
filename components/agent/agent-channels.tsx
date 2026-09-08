"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Copy, Check, X, Mail, Megaphone, FileText } from "lucide-react";
import {
  createTelegramLink, unlinkTelegram, approveDraft, rejectDraft,
} from "@/app/actions/agent";
import type { AgentDraft } from "@/lib/agent/store";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/* ── Telegram pairing ─────────────────────────────────────────────── */

export function TelegramLink({
  linked,
  available,
}: {
  linked: boolean;
  available: boolean;
}) {
  const m = useMessages();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const link = () =>
    start(async () => {
      const res = await createTelegramLink();
      if (!res.ok) return toast(res.error, "error");
      setCode(res.code);
      setBot(res.botUsername);
      router.refresh();
    });

  const unlink = () =>
    start(async () => {
      const res = await unlinkTelegram();
      if (!res.ok) return toast(res.error, "error");
      setCode(null);
      router.refresh();
    });

  const command = code ? `/start ${code}` : "";

  return (
    <div className="space-y-3 p-5">
      <p className="text-[0.78rem] leading-relaxed text-muted-foreground">{m.agent.telegramDesc}</p>

      {!available && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[0.75rem] leading-relaxed text-warning">
          {m.agent.telegramUnavailable}
        </p>
      )}

      {code && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="mb-2 text-[0.72rem] text-accent">
            {m.agent.telegramStep}
            {bot && (
              <>
                {" "}
                <a
                  href={`https://t.me/${bot}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  @{bot}
                </a>
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1.5 font-mono text-[0.72rem]">
              {command}
            </code>
            <button
              onClick={() => { navigator.clipboard?.writeText(command); toast("Copied"); }}
              aria-label="Copy"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border hover:bg-surface-2"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={link}
          disabled={pending || !available}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {m.agent.telegramLink}
        </button>
        {linked && (
          <button
            onClick={unlink}
            disabled={pending}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-danger hover:bg-danger/10")}
          >
            {m.agent.telegramUnlink}
          </button>
        )}
        {linked && <span className="text-[0.72rem] text-success">{m.agent.telegramLinked}</span>}
      </div>
    </div>
  );
}

/* ── Drafts awaiting a human ──────────────────────────────────────── */

const KIND_ICON = { email: Mail, campaign: Megaphone, proposal: FileText } as const;

export function Drafts({ drafts }: { drafts: AgentDraft[] }) {
  const m = useMessages();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (drafts.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{m.agent.noDrafts}</p>;
  }

  const act = async (id: string, approve: boolean) => {
    setBusy(id);
    const res = approve ? await approveDraft(id) : await rejectDraft(id);
    setBusy(null);
    if (!res.ok) toast(res.error, "error");
    else router.refresh();
  };

  return (
    <ul className="divide-y divide-border">
      {drafts.map((d) => {
        const Icon = KIND_ICON[d.kind];
        const sent = d.status === "sent";
        return (
          <li key={d.id} className="flex items-start gap-3 px-5 py-4">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.subject ?? d.body.slice(0, 60)}</p>
              {d.target && (
                <p className="mt-0.5 truncate text-[0.72rem] text-muted-foreground">→ {d.target}</p>
              )}
              <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[0.78rem] leading-relaxed text-muted-foreground">
                {d.body}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {sent ? (
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[0.68rem] text-success">
                  {m.agent.draftSent}
                </span>
              ) : (
                <>
                  <button
                    onClick={() => act(d.id, false)}
                    disabled={busy === d.id}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1")}
                  >
                    <X className="h-3.5 w-3.5" /> {m.agent.draftReject}
                  </button>
                  <button
                    onClick={() => act(d.id, true)}
                    disabled={busy === d.id}
                    className={cn(buttonVariants({ variant: "accent", size: "sm" }), "gap-1")}
                  >
                    {busy === d.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {d.kind === "email" ? m.agent.draftSend : m.agent.draftApprove}
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
