"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NotebookPen, Check } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Human-readable outcome for every `?notion=` code the callback can return. */
const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Notion connected", ok: true },
  denied: { text: "You declined the Notion authorization.", ok: false },
  no_code: { text: "Notion didn't return an authorization code.", ok: false },
  bad_state: { text: "Security check failed — please start the connection again.", ok: false },
  not_configured: { text: "Notion OAuth isn't configured on the server.", ok: false },
  bad_credentials: { text: "Invalid Notion client ID or secret.", ok: false },
  exchange_failed: { text: "Notion rejected the authorization code.", ok: false },
  no_page_shared: { text: "No page was shared — pick at least one page during authorization.", ok: false },
  no_database: { text: "Connected, but there's no database configured to store it.", ok: false },
  store_failed: { text: "Couldn't save the connection. Check the server logs.", ok: false },
};

export function NotionConnect({
  connected,
  workspaceName,
}: {
  connected: boolean;
  workspaceName?: string | null;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("notion");

  useEffect(() => {
    if (!status) return;
    const m = MESSAGES[status] ?? { text: `Notion: ${status}`, ok: false };
    toast(m.text, m.ok ? "success" : "error");
    // Drop the query param so a refresh doesn't re-toast.
    router.replace("/settings", { scroll: false });
  }, [status, router]);

  if (connected) {
    return (
      <span className="flex items-center gap-1.5 text-[0.75rem] text-success">
        <Check className="h-3.5 w-3.5" />
        {workspaceName ? `Connected · ${workspaceName}` : "Connected"}
      </span>
    );
  }

  return (
    <a
      href="/api/integrations/notion/authorize?next=/settings"
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
    >
      <NotebookPen className="h-3.5 w-3.5" />
      Connect Notion
    </a>
  );
}
