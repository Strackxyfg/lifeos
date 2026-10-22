"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { setEdition } from "@/app/actions/edition";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import type { Edition } from "@/lib/plans/editions";
import { cn } from "@/lib/utils";

/** One click to another edition — then the page re-renders with what it opens. */
export function SwitchEdition({
  edition,
  variant = "accent",
  className,
}: {
  edition: Edition;
  variant?: "accent" | "secondary";
  className?: string;
}) {
  const m = useMessages();
  const t = m.editions;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const name = t.names[edition];

  const go = async () => {
    if (busy) return;
    setBusy(true);
    const res = await setEdition(edition).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      toast(t.errors[res ? res.code : "failed"], "error");
      return;
    }
    toast(fill(t.switched, { edition: name }));
    router.refresh();
  };

  return (
    <button type="button" onClick={go} disabled={busy} aria-busy={busy} className={cn(buttonVariants({ variant, size: "md" }), "gap-2", className)}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUpRight className="h-4 w-4" aria-hidden />}
      {busy ? t.switching : fill(t.choose, { edition: name })}
    </button>
  );
}
