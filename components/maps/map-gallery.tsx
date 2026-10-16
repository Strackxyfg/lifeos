"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileUp, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, Waypoints } from "lucide-react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural, type Locale } from "@/lib/i18n/config";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createMap, deleteMap, duplicateMap, renameMap } from "@/app/actions/maps";
import { fold, fromOutline } from "@/lib/maps/model";
import { IMPORT_ACCEPT } from "@/lib/maps/formats";
import { templates } from "@/lib/maps/templates";
import { DEFAULT_FAMILIES } from "@/lib/maps/theme";
import { importFile } from "./import";
import { Modal } from "./modal";
import { Menu } from "./ui";
import { NewMapDialog, TemplateCard, useFamilies } from "./new-map-dialog";
import { mapThumbnail } from "./preview";

export interface GalleryMap {
  id: string;
  title: string;
  nodeCount: number;
  preview: string | null;
  updatedAt: string;
}

function ago(iso: string, now: Date, locale: Locale): string {
  const tag = locale === "fr" ? "fr-FR" : "en-GB";
  const s = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(0, "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86_400 * 7) return rtf.format(Math.round(s / 86_400), "day");
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: now.getFullYear() === new Date(iso).getFullYear() ? undefined : "numeric" }).format(new Date(iso));
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
/** The canvas colour a preview was drawn on (its first full rectangle), to frame it in the same colour. */
const backgroundOf = (svg: string) => /<rect [^>]*fill="(#[0-9a-f]{6})"\/>/i.exec(svg)?.[1];

/** Every map, as pictures: open one, start one, bring one in. */
export function MapGallery({ maps, notes, nowIso, initialNew = false }: { maps: GalleryMap[]; notes: { id: string; title: string }[]; nowIso: string; initialNew?: boolean }) {
  const m = useMessages();
  const t = m.maps;
  const g = t.gallery;
  const locale = useLocale();
  const router = useRouter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const families = useFamilies();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(initialNew);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState<GalleryMap | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<GalleryMap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return q ? maps.filter((x) => fold(x.title).includes(q)) : maps;
  }, [maps, query]);

  const reason = (code: string) => t.errors[code as keyof typeof t.errors] ?? t.errors.failed;

  const runImport = async (files: File[]) => {
    if (!files.length || importing) return;
    setCreating(false);
    setImporting(true);
    const ids: string[] = [];
    for (const f of files.slice(0, 10)) {
      const res = await importFile(f, families ?? DEFAULT_FAMILIES);
      if (res.ok) ids.push(...res.ids);
      else toast(fill(g.importFailed, { reason: res.reason === "save" ? reason(res.detail ?? "failed") : t.importErrors[res.reason] }), "error");
    }
    setImporting(false);
    if (!ids.length) return;
    toast(plural(locale, ids.length, g.imported));
    if (ids.length === 1) router.push(`/brain/maps/${ids[0]}`);
    else router.refresh();
  };

  const act = async (id: string, fn: () => Promise<{ ok: boolean; code?: string }>) => {
    setBusy(id);
    const res = await fn().catch(() => ({ ok: false, code: "network" }));
    setBusy(null);
    if (!res.ok) toast(fill(t.editor.failed, { reason: reason(res.code ?? "failed") }), "error");
    else router.refresh();
    return res.ok;
  };

  const quickStart = async (tplId: string) => {
    const tpl = templates(locale).find((x) => x.id === tplId);
    if (!tpl) return;
    setQuick(tplId);
    const doc = fromOutline(tpl.outline, tpl.style);
    let preview: string | undefined;
    try {
      preview = mapThumbnail(doc, families ?? DEFAULT_FAMILIES);
    } catch {
      preview = undefined;
    }
    const res = await createMap({ doc, preview }).catch(() => null);
    if (!res?.ok) {
      setQuick(null);
      toast(fill(t.editor.failed, { reason: reason(res ? res.code : "network") }), "error");
      return;
    }
    router.push(`/brain/maps/${res.id}`);
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    depth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  };

  return (
    <div
      className="relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        void runImport(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        ref={picker}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void runImport(files);
        }}
      />

      {/* Tools */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {maps.length > 0 && (
          <label className="flex min-w-0 basis-full items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:border-border-strong sm:max-w-xs sm:flex-1 sm:basis-auto">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={g.search}
              aria-label={g.search}
              className="min-w-0 flex-1 bg-transparent py-2 text-[0.875rem] outline-none placeholder:text-muted-foreground [@media(pointer:coarse)]:text-base"
            />
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => picker.current?.click()} disabled={importing} title={g.importHint}>
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
            {importing ? g.importing : g.import}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            {g.new}
          </Button>
        </div>
      </div>

      {maps.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="relative px-6 pb-6 pt-10 text-center sm:px-10">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">
              <Waypoints className="h-6 w-6" />
            </div>
            <h2 className="text-[1.375rem] font-medium tracking-tight">{g.emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-lg text-[0.9375rem] leading-relaxed text-muted-foreground">{g.emptyBody}</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 border-t border-border bg-background/40 p-4 sm:grid-cols-4 sm:p-5">
            {templates(locale)
              .filter((x) => ["blank", "brainstorm", "project", "decision"].includes(x.id))
              .map((tpl) => (
                <TemplateCard key={tpl.id} template={tpl} families={families} busy={quick === tpl.id} disabled={!!quick} onPick={() => void quickStart(tpl.id)} compact />
              ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border p-4">
            <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
              {t.create.templates}…
            </Button>
            <Button variant="ghost" size="sm" onClick={() => picker.current?.click()}>
              <FileUp className="h-3.5 w-3.5" />
              {g.importHint}
            </Button>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-[0.875rem] text-muted-foreground">{g.none}</p>
      ) : (
        <>
          <p className="mb-3 text-[0.75rem] text-muted-foreground">{plural(locale, shown.length, g.count)}</p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((map) => (
              <li key={map.id} className="group relative">
                <Link
                  href={`/brain/maps/${map.id}`}
                  className={cn(
                    "block overflow-hidden rounded-2xl border border-border bg-surface transition-[border-color,transform,box-shadow] duration-200",
                    "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
                    busy === map.id && "pointer-events-none opacity-60"
                  )}
                >
                  <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-background" style={map.preview ? { background: backgroundOf(map.preview) } : undefined}>
                    {map.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the map's own SVG, drawn by the editor
                      <img src={svgUrl(map.preview)} alt="" draggable={false} loading="lazy" className="h-full w-full object-contain transition-transform duration-500 ease-premium group-hover:scale-[1.03]" />
                    ) : (
                      <div className="grid h-full place-items-center text-muted-foreground/50">
                        <Waypoints className="h-10 w-10" />
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-3 pr-12">
                    <h3 className="truncate text-[0.9375rem] font-medium tracking-tight">{map.title}</h3>
                    <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
                      {plural(locale, map.nodeCount, g.ideas)} · {fill(g.updated, { when: ago(map.updatedAt, now, locale) })}
                    </p>
                  </div>
                </Link>
                <div className="absolute bottom-2.5 right-2">
                  <Menu
                    label={fill(g.actions, { title: map.title })}
                    icon={busy === map.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                    items={[
                      {
                        id: "rename",
                        label: g.rename,
                        icon: <Pencil className="h-4 w-4" />,
                        onSelect: () => {
                          setName(map.title);
                          setRenaming(map);
                        },
                      },
                      { id: "duplicate", label: g.duplicate, icon: <Copy className="h-4 w-4" />, onSelect: () => void act(map.id, () => duplicateMap(map.id)) },
                      "separator",
                      { id: "delete", label: g.delete, icon: <Trash2 className="h-4 w-4" />, tone: "danger", onSelect: () => setDeleting(map) },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-8 text-center text-[0.75rem] text-muted-foreground">{t.privacy}</p>

      {/* Dropping a file anywhere here imports it. */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[110] grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-10 py-8 text-center shadow-lift">
            <FileUp className="mx-auto mb-3 h-8 w-8 text-accent" />
            <p className="text-[1rem] font-medium">{g.dropHere}</p>
            <p className="mt-1 text-[0.75rem] text-muted-foreground">{g.importHint}</p>
          </div>
        </div>
      )}

      <NewMapDialog open={creating} onClose={() => setCreating(false)} notes={notes} onImport={() => picker.current?.click()} />

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title={g.renameTitle} closeLabel={g.cancel}>
        <form
          className="space-y-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!renaming || !name.trim()) return;
            const target = renaming;
            setRenaming(null);
            await act(target.id, () => renameMap(target.id, name));
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={1000}
            aria-label={g.renameTitle}
            data-autofocus
            className="w-full rounded-lg border border-border bg-background/60 px-3 py-2.5 text-[0.9375rem] outline-none focus:border-border-strong"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
              {g.cancel}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {g.save}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={g.deleteTitle} closeLabel={g.cancel}>
        <div className="space-y-4 p-5">
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">{fill(g.deleteBody, { title: deleting?.title ?? "" })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)} data-autofocus>
              {g.cancel}
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-600/90"
              onClick={async () => {
                if (!deleting) return;
                const target = deleting;
                setDeleting(null);
                await act(target.id, () => deleteMap(target.id));
              }}
            >
              <Trash2 className="h-4 w-4" />
              {g.delete}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
