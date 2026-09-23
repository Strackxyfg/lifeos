"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Loader2, Sparkles, Zap } from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import type { BrainLink, BrainNote } from "@/lib/brain/graph";
import type { DecisionOption } from "@/lib/brain/decide";
import { proposeDecisionOptions, recordDecision } from "@/app/actions/memory";
import type { BrainErrorCode } from "@/app/actions/brain";
import { toast } from "@/components/ui/toaster";
import { fill } from "@/lib/i18n/config";
import { useMessages } from "@/lib/i18n/client";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface Decided {
  note: BrainNote;
  links: BrainLink[];
  tension: BrainLink;
  archived: string[];
}

/**
 * Deciding a tension: the two notes face to face, options the model reads
 * from the person's own notes (optional), and the decision in their words.
 * Nothing is saved until they record it; the options are only a start.
 */
export function TensionDecision({
  link,
  a,
  b,
  aiEnabled,
  memory,
  onBack,
  onOpen,
  onDecided,
}: {
  link: BrainLink;
  a: BrainNote;
  b: BrainNote;
  aiEnabled: boolean;
  /** Migration 009: the tension can be marked resolved. */
  memory: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onDecided: (d: Decided) => void;
}) {
  const m = useMessages();
  const t = m.brain.decide;
  const [options, setOptions] = useState<{ phase: "idle" | "loading" | "ready"; list: DecisionOption[] }>({ phase: "idle", list: [] });
  const [picked, setPicked] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [region, setRegion] = useState<BrainCategoryId>("insights");
  const [aside, setAside] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const errorText = (code: BrainErrorCode) => m.brain.errors[code];

  const propose = async () => {
    setOptions({ phase: "loading", list: [] });
    const res = await proposeDecisionOptions(link.id).catch(() => null);
    if (!res || !res.ok) {
      setOptions({ phase: "idle", list: [] });
      return void toast(res ? errorText(res.code) : m.brain.errors.failed, "error");
    }
    setOptions({ phase: "ready", list: res.data });
  };

  const pick = (i: number) => {
    const o = options.list[i];
    setPicked(i);
    setTitle(o.title);
    setWhy(o.why);
    // Which side, if any, to set aside stays the person's call, one checkbox away.
    setAside(new Set());
  };

  const save = async () => {
    if (title.trim().length < 3 || saving) return;
    setSaving(true);
    const res = await recordDecision({ linkId: link.id, title: title.trim(), why: why.trim(), region, archive: [...aside] }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) return void toast(res ? errorText(res.code) : m.brain.errors.failed, "error");
    toast(memory ? t.saved : t.savedPending);
    onDecided(res.data);
  };

  const side = (note: BrainNote, label: string) => {
    const cat = categoryById(note.category);
    return (
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        className="w-full rounded-lg border border-border bg-surface p-2.5 text-left transition-colors hover:border-border-strong"
      >
        <span className="flex items-center gap-1.5 text-[0.64rem] uppercase tracking-wide text-muted">
          <span className="font-mono">{label}</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} /> {m.brain.cat[note.category].label}
        </span>
        <span className="mt-1 block text-[0.82rem] leading-snug">{note.title}</span>
        {note.detail && <span className="mt-1 line-clamp-2 block text-[0.7rem] leading-snug text-muted-foreground">{note.detail}</span>}
      </button>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease }}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {m.brain.overview}
      </button>

      <h2 className="flex items-center gap-2 text-[1.05rem] font-medium tracking-tight">
        <Zap className="h-4 w-4" style={{ color: "#fb7185" }} /> {t.title}
      </h2>
      <p className="mt-1 text-[0.74rem] leading-snug text-muted-foreground">{t.hint}</p>

      <div className="mt-3 flex flex-col items-stretch gap-1.5">
        {side(a, "A")}
        <span className="text-center text-[0.66rem] uppercase tracking-widest" style={{ color: "#fb7185" }}>{t.versus}</span>
        {side(b, "B")}
      </div>
      {link.reason && (
        <p className="mt-2 text-[0.72rem] leading-snug text-muted-foreground">
          <span className="text-muted">{t.why} · </span>
          {link.reason}
        </p>
      )}

      <section className="mt-4">
        {aiEnabled ? (
          options.phase === "idle" ? (
            <button
              type="button"
              onClick={() => void propose()}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 text-[0.75rem] text-accent hover:bg-accent/10"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t.propose}
            </button>
          ) : options.phase === "loading" ? (
            <p className="flex items-center gap-2 text-[0.76rem] text-muted-foreground" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> {t.proposing}
            </p>
          ) : (
            <>
              <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted">{t.options}</p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {options.list.map((o, i) => (
                  <li key={o.title}>
                    <button
                      type="button"
                      onClick={() => pick(i)}
                      aria-pressed={picked === i}
                      className={cn(
                        "w-full rounded-lg border p-2.5 text-left transition-colors",
                        picked === i ? "border-accent/60 bg-accent/10" : "border-border hover:border-border-strong"
                      )}
                    >
                      <span className="block text-[0.8rem] leading-snug">{o.title}</span>
                      {o.why && <span className="mt-0.5 block text-[0.7rem] leading-snug text-muted-foreground">{o.why}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : (
          <p className="text-[0.72rem] text-muted">{t.noAi}</p>
        )}
      </section>

      <section className="mt-4">
        <label htmlFor="decision-title" className="text-[0.7rem] font-medium uppercase tracking-wide text-muted">{t.yours}</label>
        <textarea
          id="decision-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value.replace(/\n/g, " "));
            setPicked(null);
          }}
          placeholder={t.placeholder}
          rows={2}
          maxLength={500}
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-surface-2/40 p-2.5 text-[0.82rem] leading-snug outline-none placeholder:text-muted focus:border-border-strong"
        />
        <label htmlFor="decision-why" className="mt-2 block text-[0.7rem] text-muted">{t.reasonLabel}</label>
        <textarea
          id="decision-why"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder={t.reasonPlaceholder}
          rows={2}
          maxLength={2_000}
          className="mt-1 w-full resize-y rounded-lg border border-border bg-surface-2/40 p-2.5 text-[0.76rem] leading-snug outline-none placeholder:text-muted focus:border-border-strong"
        />

        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="decision-region" className="text-[0.7rem] text-muted">{t.region}</label>
          <select
            id="decision-region"
            value={region}
            onChange={(e) => setRegion(e.target.value as BrainCategoryId)}
            className="rounded-md border border-border bg-surface-2/40 px-1.5 py-0.5 text-[0.72rem] text-muted-foreground outline-none focus:border-border-strong"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{m.brain.cat[c.id].label}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex flex-col gap-1">
          {[a, b].map((n) => (
            <label key={n.id} className="flex cursor-pointer items-start gap-2 text-[0.72rem] text-muted-foreground">
              <input
                type="checkbox"
                checked={aside.has(n.id)}
                onChange={(e) =>
                  setAside((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(n.id);
                    else next.delete(n.id);
                    return next;
                  })
                }
                className="mt-0.5 accent-[#22d3ee]"
              />
              <span className="min-w-0 truncate">{fill(t.setAside, { title: n.title })}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={title.trim().length < 3 || saving}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.78rem] font-medium text-background transition-opacity disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t.save}
        </button>
      </section>
    </motion.div>
  );
}
