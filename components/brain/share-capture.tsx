"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Scissors, Sparkles } from "lucide-react";
import type { Shared } from "@/lib/brain/share";
import { createNote } from "@/app/actions/brain";
import { weaveNotes } from "@/app/actions/weave";
import { classifyThought } from "./classify-client";
import { toast } from "@/components/ui/toaster";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import type { BrainCategoryId } from "@/lib/data/brain";

/** Where a long share waits for the brain dump to open: a URL could not carry it. */
export const DUMP_HANDOFF = "lifeos:dump-text";

/**
 * What another app shared, to confirm into the brain. Nothing is saved until
 * the person presses the button: the page is reached through a URL anyone can
 * build, so opening it must never be enough to write a note.
 */
export function ShareCapture({ shared }: { shared: Shared | null }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const t = m.share;
  const [title, setTitle] = useState(shared?.title ?? "");
  const [detail, setDetail] = useState(() => [shared?.detail, shared?.url].filter(Boolean).join("\n\n"));
  const [state, setState] = useState<{ phase: "idle" | "saving" } | { phase: "saved"; id: string; region: BrainCategoryId }>({
    phase: "idle",
  });

  if (!shared) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-muted-foreground">{t.empty}</p>
        <Link href="/brain" className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
          {t.toBrain} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  const save = async () => {
    const clean = title.trim();
    if (!clean || state.phase !== "idle") return;
    setState({ phase: "saving" });
    const region = await classifyThought(clean, locale);
    const res = await createNote({ title: clean, detail: detail.trim() || null, category: region }).catch(() => null);
    if (!res || !res.ok) {
      setState({ phase: "idle" });
      return void toast(res ? m.brain.errors[res.code] : m.brain.errors.failed, "error");
    }
    setState({ phase: "saved", id: res.data.id, region });
    // Connected in the background, like any capture; a failure only means
    // "organise my brain" will catch up later.
    void weaveNotes([res.data.id])
      .then((r) => {
        if (r.ok && r.data.created.length > 0) toast(plural(locale, r.data.created.length, m.brain.weave.created));
      })
      .catch(() => {});
  };

  const split = () => {
    try {
      sessionStorage.setItem(DUMP_HANDOFF, shared.full);
    } catch {
      // Private browsing without storage: the dump opens empty.
    }
    router.push("/brain?dump=1");
  };

  if (state.phase === "saved") {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Check className="h-4 w-4 text-success" /> {fill(t.saved, { region: m.brain.cat[state.region].label })}
        </p>
        <p className="mt-2 text-[0.82rem] text-muted-foreground">{title}</p>
        <Link
          href={`/brain?note=${encodeURIComponent(state.id)}`}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.8rem] font-medium text-background"
        >
          {t.open} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-5">
      <label htmlFor="share-title" className="text-[0.72rem] font-medium uppercase tracking-wide text-muted">{t.noteTitle}</label>
      <input
        id="share-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={500}
        className="mt-1.5 w-full rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm outline-none focus:border-border-strong"
      />
      <label htmlFor="share-detail" className="mt-3 block text-[0.72rem] font-medium uppercase tracking-wide text-muted">{t.detail}</label>
      <textarea
        id="share-detail"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={5}
        maxLength={20_000}
        className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-[0.82rem] leading-relaxed outline-none focus:border-border-strong"
      />

      {shared.long && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2">
          <p className="text-[0.76rem] text-muted-foreground">{t.splitHint}</p>
          <button type="button" onClick={split} className="inline-flex shrink-0 items-center gap-1.5 text-[0.76rem] font-medium text-accent hover:underline">
            <Scissors className="h-3.5 w-3.5" /> {t.split}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!title.trim() || state.phase === "saving"}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[0.82rem] font-medium text-background transition-opacity disabled:opacity-40"
      >
        {state.phase === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {state.phase === "saving" ? t.saving : t.save}
      </button>
    </div>
  );
}
