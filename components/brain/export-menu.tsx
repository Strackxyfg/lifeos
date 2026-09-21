"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileJson, FileText } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Take everything with you. Plain links to the export route: the download is
 * the browser's own, with nothing held in page memory.
 */
export function ExportMenu() {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
      >
        <Download className="h-3.5 w-3.5" /> {m.brain.export}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          <p className="px-2.5 pb-2 pt-1.5 text-[0.72rem] leading-relaxed text-muted-foreground">{m.brain.exportHint}</p>
          {[
            { href: "/api/brain/export?format=md", icon: FileText, label: m.brain.exportMarkdown },
            { href: "/api/brain/export?format=json", icon: FileJson, label: m.brain.exportJson },
          ].map((o) => (
            <a
              key={o.href}
              role="menuitem"
              href={o.href}
              download
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.82rem] hover:bg-surface-2"
            >
              <o.icon className="h-4 w-4 text-muted-foreground" /> {o.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
