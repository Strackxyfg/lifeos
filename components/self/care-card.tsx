"use client";

import { ExternalLink, LifeBuoy, Phone, X } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";

/**
 * Who to call, now. Shown when what someone wrote to their double says they
 * may be in danger — from their words alone, before and whatever the answer
 * — and on demand under the conversation. Numbers are links: one tap on a
 * phone dials.
 */
export function CareCard({ onClose }: { onClose?: () => void }) {
  const c = useMessages().self.care;
  return (
    <section role="note" aria-label={c.title} className="relative rounded-xl border border-[#0ea5e9]/35 bg-[#0ea5e9]/[0.07] p-4">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={c.close}
          title={c.close}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <p className="flex items-center gap-2 pr-8 text-[0.88rem] font-medium">
        <LifeBuoy className="h-4 w-4 shrink-0 text-[#0ea5e9]" aria-hidden /> {c.title}
      </p>
      <p className="mt-1.5 text-[0.8rem] leading-relaxed text-muted-foreground">{c.body}</p>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {c.lines.map((line) => (
          <li key={line.label}>
            <a
              href={`tel:${line.tel}`}
              className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-1.5 transition-colors hover:border-border-strong"
            >
              <Phone className="h-3.5 w-3.5 shrink-0 text-[#0ea5e9]" aria-hidden />
              <span className="shrink-0 font-mono text-[0.92rem] font-medium tabular-nums">{line.number}</span>
              <span className="min-w-0 flex-1 text-[0.72rem] leading-snug text-muted-foreground">{line.label}</span>
            </a>
          </li>
        ))}
      </ul>
      <a href={c.findUrl} target="_blank" rel="noopener noreferrer" className="mt-2.5 inline-flex items-center gap-1 text-[0.76rem] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {c.find} <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </section>
  );
}
