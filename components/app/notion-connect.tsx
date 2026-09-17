"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { NotebookPen, Check, AlertTriangle, X, Copy } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Every `?notion=` code the OAuth callback can return. */
type NotionCode =
  | "connected" | "denied" | "no_code" | "bad_state" | "not_configured"
  | "not_signed_in" | "bad_credentials" | "exchange_failed"
  | "no_page_shared" | "no_database" | "store_failed";

const CODES: NotionCode[] = [
  "connected", "denied", "no_code", "bad_state", "not_configured",
  "not_signed_in", "bad_credentials", "exchange_failed",
  "no_page_shared", "no_database", "store_failed",
];

export function NotionConnect({
  connected,
  workspaceName,
}: {
  connected: boolean;
  workspaceName?: string | null;
}) {
  const m = useMessages();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = params.get("notion");

  /**
   * The outcome is held in state rather than read from the URL each render.
   *
   * The query param is stripped immediately so a refresh doesn't replay it,
   * but the *message* has to outlive that. Previously the reason existed only
   * as a toast on a URL that was rewritten in the same tick — so a failure you
   * needed to act on ("share a page") was gone before you could read it, and
   * all that was left was a button that didn't work.
   */
  const [outcome, setOutcome] = useState<NotionCode | null>(null);

  /**
   * The callback URL this deployment will actually send to Notion.
   *
   * Notion rejects any `redirect_uri` not registered on the integration, and
   * it does so on its own consent screen — the user never comes back, so the
   * app gets no error code and can say nothing. Showing the exact string here
   * turns "redirect_uri missing or invalid" from a guessing game into a
   * copy-paste. Read from the live origin for the same reason the server
   * derives it that way: a preview deployment has a different host, and a
   * hardcoded value would be wrong on all but one of them.
   */
  const [callbackUrl, setCallbackUrl] = useState("");
  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/integrations/notion/callback`);
  }, []);

  useEffect(() => {
    if (!status) return;
    const code = (CODES as string[]).includes(status) ? (status as NotionCode) : null;
    setOutcome(code ?? "store_failed");

    const text = code ? m.notion[code] : `Notion: ${status}`;
    toast(text, code === "connected" ? "success" : "error");

    // Clear the param on whichever page we actually landed on — the callback
    // honours `next`, so hardcoding /settings would bounce the user elsewhere.
    router.replace(pathname, { scroll: false });
  }, [status, router, pathname, m]);

  if (connected) {
    return (
      <span className="flex items-center gap-1.5 text-[0.75rem] text-success">
        <Check className="h-3.5 w-3.5" />
        {workspaceName ? `${m.notion.connected} · ${workspaceName}` : m.notion.connected}
      </span>
    );
  }

  const failed = outcome && outcome !== "connected";

  return (
    <div className="flex flex-col items-end gap-2">
      <a
        href="/api/integrations/notion/authorize?next=/settings"
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
      >
        <NotebookPen className="h-3.5 w-3.5" />
        {failed ? m.notion.retry : m.notion.connect}
      </a>

      {failed && (
        <div
          role="alert"
          className="flex max-w-xs items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-left"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <p className="flex-1 text-[0.72rem] leading-relaxed text-danger">
            {m.notion[outcome]}
          </p>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            aria-label={m.notion.dismiss}
            className="shrink-0 rounded text-danger/70 transition-colors hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {callbackUrl && (
        <details className="max-w-xs text-right">
          <summary className="cursor-pointer list-none text-[0.68rem] text-muted-foreground underline-offset-4 hover:underline">
            {m.notion.redirectHelp}
          </summary>
          <div className="mt-1.5 rounded-lg border border-border bg-surface-2/40 p-2 text-left">
            <p className="mb-1.5 text-[0.68rem] leading-relaxed text-muted-foreground">
              {m.notion.redirectHint}
            </p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-1.5 py-1 font-mono text-[0.66rem]">
                {callbackUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(callbackUrl);
                  toast(m.notion.copied, "success");
                }}
                aria-label={m.notion.copy}
                className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border hover:bg-surface-2"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
