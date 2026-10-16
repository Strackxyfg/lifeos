"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, FileUp, Loader2, Search } from "lucide-react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createMap, createMapFromNote } from "@/app/actions/maps";
import { fold, fromOutline } from "@/lib/maps/model";
import { templates, type Template } from "@/lib/maps/templates";
import { DEFAULT_FAMILIES, type FontFamilies } from "@/lib/maps/theme";
import { THEMES } from "@/lib/maps/theme";
import { EMOJI_FONT } from "@/lib/maps/draw";
import { pageFamilies } from "./client";
import { mapThumbnail, previewUrl } from "./preview";
import { Modal } from "./modal";

/** The families of the page, once it is in the browser (the server has no fonts to ask). */
export function useFamilies(): FontFamilies | null {
  const [f, setF] = useState<FontFamilies | null>(null);
  useEffect(() => setF(pageFamilies()), []);
  return f;
}

/** A template's card: its picture, drawn by the real renderer, its name and what it is for. */
export function TemplateCard({ template, families, busy, disabled, onPick, compact }: { template: Template; families: FontFamilies | null; busy: boolean; disabled: boolean; onPick: () => void; compact?: boolean }) {
  const theme = THEMES[template.style.theme ?? "daylight"];
  const src = useMemo(() => (families ? previewUrl(template.outline, template.style, families, `tpl:${template.id}`) : null), [families, template]);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left transition-[border-color,transform,box-shadow] duration-200",
        "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
        "disabled:pointer-events-none disabled:opacity-60"
      )}
    >
      <span className={cn("relative block overflow-hidden", compact ? "aspect-[16/9]" : "aspect-[16/10]")} style={{ background: theme.background }}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element -- an inline SVG drawn here
          <img src={src} alt="" draggable={false} className="h-full w-full object-contain p-1 transition-transform duration-500 ease-premium group-hover:scale-[1.05]" />
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-black/30">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </span>
        )}
      </span>
      <span className="flex items-start gap-2 p-2.5">
        <span className="text-[1rem] leading-5" style={{ fontFamily: EMOJI_FONT }} aria-hidden>
          {template.emoji}
        </span>
        <span className="min-w-0">
          <span className="block text-[0.8125rem] font-medium leading-5">{template.name}</span>
          {!compact && <span className="mt-0.5 block text-[0.6875rem] leading-snug text-muted-foreground">{template.hint}</span>}
        </span>
      </span>
    </button>
  );
}

/** Starting a map: from a template, from a note of the brain, or from a file. */
export function NewMapDialog({
  open,
  onClose,
  notes,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  notes: { id: string; title: string }[];
  onImport: () => void;
}) {
  const m = useMessages();
  const t = m.maps;
  const locale = useLocale();
  const router = useRouter();
  const families = useFamilies();
  const list = useMemo(() => templates(locale), [locale]);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const hits = useMemo(() => {
    const q = fold(query.trim());
    return (q ? notes.filter((n) => fold(n.title).includes(q)) : notes).slice(0, 6);
  }, [notes, query]);

  const failed = (code: string) => toast(fill(t.editor.failed, { reason: t.errors[code as keyof typeof t.errors] ?? t.errors.failed }), "error");

  const fromTemplate = async (tpl: Template) => {
    setBusy(tpl.id);
    const doc = fromOutline(tpl.outline, tpl.style);
    let preview: string | undefined;
    try {
      preview = mapThumbnail(doc, families ?? DEFAULT_FAMILIES);
    } catch {
      preview = undefined;
    }
    const res = await createMap({ doc, preview }).catch(() => null);
    if (!res?.ok) {
      setBusy(null);
      failed(res ? res.code : "network");
      return;
    }
    router.push(`/brain/maps/${res.id}`);
  };

  const fromNote = async (noteId: string) => {
    setBusy(`note:${noteId}`);
    const res = await createMapFromNote(noteId).catch(() => null);
    if (!res?.ok) {
      setBusy(null);
      failed(res ? res.code : "network");
      return;
    }
    router.push(`/brain/maps/${res.id}`);
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t.create.title} wide closeLabel={t.create.close}>
      <div className="space-y-6 p-5">
        <section>
          <h3 className="mb-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t.create.templates}</h3>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {list.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} families={families} busy={busy === tpl.id} disabled={!!busy} onPick={() => void fromTemplate(tpl)} />
            ))}
          </div>
        </section>

        {notes.length > 0 && (
          <section>
            <h3 className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t.create.fromNote}</h3>
            <p className="mb-2.5 mt-1 text-[0.75rem] text-muted-foreground">{t.create.fromNoteHint}</p>
            <label className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 focus-within:border-border-strong">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.create.searchNotes}
                aria-label={t.create.searchNotes}
                className="min-w-0 flex-1 bg-transparent py-2 text-[0.8125rem] outline-none placeholder:text-muted-foreground [@media(pointer:coarse)]:text-base"
              />
            </label>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {hits.length ? (
                hits.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void fromNote(n.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[0.8125rem] transition-colors hover:bg-surface-2 disabled:opacity-60"
                    >
                      {busy === `note:${n.id}` ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Brain className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{n.title}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2.5 text-[0.75rem] text-muted-foreground">{t.create.noNotes}</li>
              )}
            </ul>
          </section>
        )}

        <div className="flex flex-col items-start gap-1.5 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.75rem] text-muted-foreground">{t.gallery.importHint}</p>
          <Button variant="secondary" size="sm" onClick={onImport} disabled={!!busy}>
            <FileUp className="h-3.5 w-3.5" />
            {t.create.importFile}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
