"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, AudioLines, Check, Loader2, Mic, RotateCcw, Scissors, Square } from "lucide-react";
import { categories, categoryById, type BrainCategoryId } from "@/lib/data/brain";
import { keepAtoms, type Atom } from "@/lib/brain/atomize";
import { RELATION_COLOR } from "@/lib/brain/relations";
import type { BrainLink, BrainNote } from "@/lib/brain/graph";
import { saveBrainDump, splitBrainDump, type DumpSplit } from "@/app/actions/dump";
import { toast } from "@/components/ui/toaster";
import { plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MAX_RECORDING_MS, extensionFor, useRecorder, type RecorderError } from "./use-recorder";

type TranscribeError = "denied" | "unsupported" | "too_large" | "empty" | "rate_limit" | "unavailable" | "failed";

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * "Empty your head": a voice memo or a pasted text becomes separate notes,
 * filed and connected — shown first, saved only once the person has read them.
 *
 * Three moments, one panel: compose (record or paste), preview (edit, refile,
 * untick), saved (the notes join the brain and are woven into it).
 */
export function BrainDump({
  initialText,
  voiceEnabled,
  onBack,
  onSaved,
}: {
  initialText: string;
  /** A transcription provider is configured. */
  voiceEnabled: boolean;
  onBack: () => void;
  onSaved: (notes: BrainNote[], links: BrainLink[]) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.brain.dump;

  const [text, setText] = useState(initialText);
  const [phase, setPhase] = useState<"compose" | "transcribing" | "splitting" | "preview" | "saving">("compose");
  const [split, setSplit] = useState<DumpSplit | null>(null);
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [keep, setKeep] = useState<boolean[]>([]);
  // A pure voice memo — nothing typed before it — goes straight to the split.
  const autoSplit = useRef(false);

  const runSplit = useCallback(
    async (source: string) => {
      if (!source.trim()) return;
      setPhase("splitting");
      const res = await splitBrainDump(source).catch(() => null);
      if (!res || !res.ok || res.data.atoms.length === 0) {
        setPhase("compose");
        return void toast(m.brain.errors.failed, "error");
      }
      setSplit(res.data);
      setAtoms(res.data.atoms);
      // A note already in the brain starts unticked: adding it would only connect it.
      setKeep(res.data.existing.map((id) => id === null));
      setPhase("preview");
    },
    [m]
  );

  const transcribe = useCallback(
    async (audio: Blob) => {
      setPhase("transcribing");
      const form = new FormData();
      form.append("audio", new File([audio], `memo.${extensionFor(audio.type)}`, { type: audio.type }));
      form.append("locale", locale);
      let error: TranscribeError | null = null;
      let transcript = "";
      try {
        const res = await fetch("/api/brain/transcribe", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: TranscribeError };
        if (res.ok && data.text) transcript = data.text;
        else error = data.error && data.error in t.errors ? data.error : "failed";
      } catch {
        error = "failed";
      }
      if (error) {
        setPhase("compose");
        return void toast(t.errors[error], "error");
      }
      const next = text.trim() ? `${text.trim()}\n\n${transcript}` : transcript;
      setText(next);
      if (autoSplit.current) void runSplit(next);
      else setPhase("compose");
    },
    [locale, t, text, runSplit]
  );

  const recorder = useRecorder({
    onRecorded: (audio) => void transcribe(audio),
    onError: (e: RecorderError) => toast(t.errors[e], "error"),
  });

  const startRecording = () => {
    autoSplit.current = !text.trim();
    void recorder.start();
  };

  const kept = useMemo(() => keepAtoms({ atoms, relations: split?.relations ?? [] }, keep), [atoms, keep, split]);
  const count = kept.atoms.filter((a) => a.title.trim()).length;

  const save = async () => {
    if (count === 0 || phase === "saving") return;
    setPhase("saving");
    const payload = {
      atoms: kept.atoms.map((a) => ({ ...a, title: a.title.trim() })),
      relations: kept.relations,
    };
    const res = await saveBrainDump(payload).catch(() => null);
    if (!res || !res.ok) {
      setPhase("preview");
      return void toast(m.brain.errors.failed, "error");
    }
    onSaved(res.data.notes, res.data.links);
  };

  const edit = (i: number, patch: Partial<Atom>) => setAtoms((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const busy = phase === "transcribing" || phase === "splitting" || phase === "saving";

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease }}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {m.brain.overview}
      </button>

      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
          <AudioLines className="h-4 w-4" />
        </span>
        <h2 className="text-[1.05rem] font-medium tracking-tight">{t.title}</h2>
      </div>

      {phase === "preview" || phase === "saving" ? (
        preview()
      ) : (
        <>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-muted-foreground">{t.intro}</p>

          {voiceEnabled && recorder.supported ? (
            <div className="mt-4 rounded-xl border border-border bg-surface-2/30 p-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={recorder.recording ? recorder.stop : startRecording}
                  disabled={busy}
                  aria-pressed={recorder.recording}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[0.8rem] font-medium transition-colors disabled:opacity-40",
                    recorder.recording ? "bg-danger/15 text-danger" : "bg-foreground text-background"
                  )}
                >
                  {recorder.recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  {recorder.recording ? t.stop : t.record}
                </button>
                {recorder.recording ? (
                  <div className="flex flex-1 items-center gap-2" role="status" aria-label={t.recording}>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
                    <span className="font-mono text-[0.78rem] tabular-nums">
                      {clock(recorder.elapsed)} <span className="text-muted">/ {clock(MAX_RECORDING_MS)}</span>
                    </span>
                    <Meter level={recorder.level} />
                  </div>
                ) : phase === "transcribing" ? (
                  <span role="status" className="flex items-center gap-1.5 text-[0.76rem] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.transcribing}
                  </span>
                ) : (
                  <span className="text-[0.72rem] text-muted">{t.limit}</span>
                )}
              </div>
              <p className="mt-2.5 text-[0.68rem] leading-snug text-muted">{t.voiceDisclosure}</p>
            </div>
          ) : (
            !voiceEnabled && <p className="mt-3 text-[0.72rem] text-muted">{t.voiceOff}</p>
          )}

          <label className="sr-only" htmlFor="dump-text">{t.placeholder}</label>
          <textarea
            id="dump-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.placeholder}
            rows={9}
            maxLength={20_000}
            disabled={busy || recorder.recording}
            className="mt-3 w-full resize-y rounded-xl border border-border bg-surface-2/40 p-3 text-[0.82rem] leading-relaxed outline-none placeholder:text-muted focus:border-border-strong disabled:opacity-60"
          />

          <button
            type="button"
            onClick={() => void runSplit(text)}
            disabled={!text.trim() || busy || recorder.recording}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.78rem] font-medium text-background transition-opacity disabled:opacity-40"
          >
            {phase === "splitting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
            {phase === "splitting" ? t.splitting : t.split}
          </button>
        </>
      )}
    </motion.div>
  );

  function preview() {
    if (!split) return null;
    const notice =
      split.by === "rules"
        ? split.fallback === "rate_limit"
          ? t.byRulesResting
          : split.fallback === "failed"
            ? t.byRulesFailed
            : t.byRules
        : null;
    // Titles as the person has edited them, for the connections list.
    const title = (i: number) => kept.atoms[i]?.title || "…";

    return (
      <div className="mt-3">
        <p className="text-[0.82rem] font-medium">{plural(locale, atoms.length, t.found)}</p>
        <p className="mt-0.5 text-[0.72rem] leading-snug text-muted-foreground">{t.previewHint}</p>
        {notice && <p className="mt-2 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 text-[0.7rem] text-muted-foreground">{notice}</p>}

        <ul className="mt-3 flex flex-col gap-2">
          {atoms.map((atom, i) => {
            const cat = categoryById(atom.region);
            const on = keep[i] ?? false;
            return (
              <li key={i} className={cn("rounded-lg border border-border p-2.5 transition-opacity", !on && "opacity-50")}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setKeep((prev) => prev.map((k, j) => (j === i ? e.target.checked : k)))}
                    aria-label={atom.title}
                    className="mt-1 h-3.5 w-3.5 shrink-0 accent-[#22d3ee]"
                  />
                  <GrowingField
                    value={atom.title}
                    onChange={(title) => edit(i, { title })}
                    label={m.brain.note.titlePlaceholder}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
                  <select
                    value={atom.region}
                    onChange={(e) => edit(i, { region: e.target.value as BrainCategoryId })}
                    aria-label={t.region}
                    className="rounded-md border border-border bg-surface-2/40 px-1.5 py-0.5 text-[0.7rem] text-muted-foreground outline-none focus:border-border-strong"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{m.brain.cat[c.id].label}</option>
                    ))}
                  </select>
                  {split.existing[i] && <span className="text-[0.66rem] text-muted">{t.existing}</span>}
                </div>
                {atom.detail && <p className="mt-1.5 whitespace-pre-line pl-5 text-[0.72rem] leading-snug text-muted-foreground">{atom.detail}</p>}
              </li>
            );
          })}
        </ul>

        {kept.relations.length > 0 && (
          <section className="mt-4">
            <p className="text-[0.72rem] font-medium uppercase tracking-wide text-muted">{t.connections}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {kept.relations.map((r, i) => {
                const from = r.from ?? r.a;
                const to = from === r.a ? r.b : r.a;
                return (
                  <li key={i} className="text-[0.74rem] leading-snug text-muted-foreground">
                    <span className="mr-1.5 inline-block h-0.5 w-3 rounded-full align-middle" style={{ background: RELATION_COLOR[r.kind] }} />
                    <span className="text-foreground">{title(from)}</span>{" "}
                    <span className="lowercase">{m.brain.relation[r.kind][r.from === null ? "both" : "out"]}</span>{" "}
                    <span className="text-foreground">{title(to)}</span>
                    {r.reason && <span className="block pl-[1.125rem] text-[0.68rem] text-muted">{r.reason}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-2 border-t border-border bg-surface/95 pb-1 pt-3 backdrop-blur">
          <button
            type="button"
            onClick={() => setPhase("compose")}
            disabled={phase === "saving"}
            className="inline-flex items-center gap-1.5 text-[0.76rem] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t.restart}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={count === 0 || phase === "saving"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.78rem] font-medium text-background transition-opacity disabled:opacity-40"
          >
            {phase === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {plural(locale, count, t.add)}
          </button>
        </div>
      </div>
    );
  }
}

/** Five bars that rise with the voice: proof the microphone hears you. */
function Meter({ level }: { level: number }) {
  return (
    <span className="ml-auto flex h-4 items-end gap-0.5" aria-hidden>
      {[0.2, 0.45, 0.7, 0.45, 0.2].map((w, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-danger/70 transition-[height] duration-75"
          style={{ height: `${Math.max(12, Math.min(100, level * 100 * (0.6 + w)))}%` }}
        />
      ))}
    </span>
  );
}

/** A one-line title that wraps and grows with its text, never scrolls. */
function GrowingField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      // A title is one line: Enter would only add a break the note never shows.
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      rows={1}
      maxLength={500}
      aria-label={label}
      className="flex-1 resize-none overflow-hidden bg-transparent text-[0.8rem] leading-snug outline-none"
    />
  );
}
