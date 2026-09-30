"use client";

import { useState } from "react";
import { BookOpenCheck, Loader2, Plus } from "lucide-react";
import { DIMENSIONS, type Dimension, type Portrait } from "@/lib/self/portrait";
import { useMessages } from "@/lib/i18n/client";
import { TraitRow, type TraitHandlers } from "./trait-row";

function AddTrait({ dimension, onAdd }: { dimension: Dimension; onAdd: (d: Dimension, statement: string) => Promise<boolean> }) {
  const m = useMessages();
  const t = m.self.portrait;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const s = text.trim();
    if (s.length < 3) return;
    setSaving(true);
    const ok = await onAdd(dimension, s);
    setSaving(false);
    if (ok) {
      setText("");
      setOpen(false);
    }
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[0.72rem] text-muted-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> {t.add}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") setOpen(false);
        }}
        autoFocus
        maxLength={200}
        placeholder={t.addPlaceholder}
        aria-label={`${t.add} — ${m.self.dimensions[dimension]}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2/40 px-2.5 text-[0.8rem] outline-none focus:border-border-strong"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || text.trim().length < 3}
        className="rounded-md bg-foreground px-2.5 py-1 text-[0.74rem] font-medium text-background disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : t.save}
      </button>
    </div>
  );
}

export function PortraitPanel({
  portrait,
  aiEnabled,
  reading,
  onRead,
  onAdd,
  handlers,
}: {
  portrait: Portrait;
  aiEnabled: boolean;
  reading: boolean;
  onRead: () => void;
  onAdd: (d: Dimension, statement: string) => Promise<boolean>;
  handlers: TraitHandlers;
}) {
  const m = useMessages();
  const t = m.self.portrait;
  const total = DIMENSIONS.reduce((s, d) => s + portrait[d].length, 0);

  return (
    <section id="portrait" aria-labelledby="portrait-title" className="scroll-mt-6 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="portrait-title" className="text-[0.95rem] font-medium">
          {t.title}
        </h2>
        {aiEnabled && (
          <button
            type="button"
            onClick={onRead}
            disabled={reading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[0.74rem] transition-colors hover:border-border-strong disabled:opacity-50"
          >
            {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpenCheck className="h-3.5 w-3.5" />}
            {reading ? t.reading : t.read}
          </button>
        )}
      </div>
      <p className="mt-1 text-[0.74rem] leading-relaxed text-muted-foreground">{t.hint}</p>
      {total === 0 && <p className="mt-3 rounded-lg border border-dashed border-accent/30 bg-accent/5 p-3 text-[0.8rem] leading-relaxed">{t.empty}</p>}

      <div className="mt-4 flex flex-col gap-4">
        {DIMENSIONS.map((d) => (
          <div key={d}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[0.74rem] font-medium uppercase tracking-wider text-muted">{m.self.dimensions[d]}</h3>
              <AddTrait dimension={d} onAdd={onAdd} />
            </div>
            {portrait[d].length === 0 ? (
              <p className="mt-1 text-[0.76rem] text-muted-foreground">{t.none}</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {portrait[d].map((trait) => (
                  <TraitRow key={trait.id} trait={trait} quotes={trait.quotes} handlers={handlers} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[0.68rem] text-muted">{m.self.privacy}</p>
    </section>
  );
}
