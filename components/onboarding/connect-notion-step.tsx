"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { NotebookPen, Check, ArrowRight, ShieldCheck } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

const ERRORS: Record<string, string> = {
  denied: "You declined the Notion authorization.",
  no_code: "Notion didn't return an authorization code.",
  bad_state: "Security check failed — please try again.",
  not_configured: "Notion OAuth isn't configured on the server.",
  bad_credentials: "Invalid Notion client ID or secret.",
  exchange_failed: "Notion rejected the authorization code.",
  no_page_shared: "No page was shared — pick at least one page when authorizing.",
  store_failed: "Couldn't save the connection.",
};

/**
 * First step of onboarding: the user connects Notion *before* answering
 * questions, so generation always has somewhere to build. Skipped entirely
 * when a connection already exists.
 */
export function ConnectNotionStep({ connected }: { connected: boolean }) {
  const m = useMessages();
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("notion");

  useEffect(() => {
    if (!status || status === "connected") return;
    toast(ERRORS[status] ?? `Notion: ${status}`, "error");
    router.replace("/onboarding", { scroll: false });
  }, [status, router]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className="mx-auto flex max-w-md flex-col items-center text-center"
    >
      <span className="grid h-12 w-12 place-items-center rounded-xl border border-border bg-surface">
        <NotebookPen className="h-5 w-5 text-accent" />
      </span>

      <h1 className="mt-6 text-h2 tracking-tight">{m.onboarding.connectTitle}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
        {m.onboarding.connectDesc}
      </p>

      <ul className="mt-6 w-full space-y-2.5 text-left">
        {[m.onboarding.connectPoint1, m.onboarding.connectPoint2, m.onboarding.connectPoint3].map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-[0.875rem] text-muted-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            {p}
          </li>
        ))}
      </ul>

      {connected ? (
        <div className="mt-8 w-full">
          <p className="mb-3 flex items-center justify-center gap-1.5 text-[0.8125rem] text-success">
            <Check className="h-4 w-4" /> {m.onboarding.connected}
          </p>
          <a href="/onboarding?step=questions" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            {m.onboarding.continue} <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      ) : (
        <a
          href="/api/integrations/notion/authorize?next=/onboarding"
          className={cn(buttonVariants({ size: "lg" }), "mt-8 w-full")}
        >
          <NotebookPen className="h-4 w-4" /> {m.onboarding.connectCta}
        </a>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-[0.75rem] text-muted">
        <ShieldCheck className="h-3.5 w-3.5" />
        {m.onboarding.connectPrivacy}
      </p>
    </motion.div>
  );
}
