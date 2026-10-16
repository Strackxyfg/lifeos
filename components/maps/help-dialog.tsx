"use client";

import { useMessages } from "@/lib/i18n/client";
import { Modal } from "./modal";

/** Every shortcut of the map, on one screen. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useMessages();
  const t = m.maps.help;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const keys = (s: string) => (mac ? s.replace(/Ctrl/g, "⌘").replace(/\bAlt\b/g, "⌥") : s);
  return (
    <Modal open={open} onClose={onClose} title={t.title} wide closeLabel={m.maps.inspector.close}>
      <dl className="grid gap-x-6 gap-y-0.5 p-5 sm:grid-cols-2">
        {t.keys.map(([k, what]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
            <dt className="text-[0.8125rem] text-muted-foreground">{what}</dt>
            <dd className="flex shrink-0 flex-wrap justify-end gap-1">
              {keys(k)
                .split(" · ")
                .map((part) => (
                  <kbd key={part} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground">
                    {part}
                  </kbd>
                ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="px-5 pb-5 text-[0.75rem] text-muted-foreground">{m.maps.editor.hint}</p>
    </Modal>
  );
}
