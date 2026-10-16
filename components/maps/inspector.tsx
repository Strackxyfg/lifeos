"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, ExternalLink, ImagePlus, Link2, Loader2, Search, Trash2, Unlink, X } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { createNote } from "@/app/actions/brain";
import { cn } from "@/lib/utils";
import { cleanUrl, fold, label, parentOf, type MapDoc, type NodePatch } from "@/lib/maps/model";
import { branchColor, themeOf } from "@/lib/maps/theme";
import { EmojiPicker } from "./emoji-picker";
import { imageUrl } from "./client";
import { Choice, Section, SidePanel } from "./ui";

export type InspectorFocus = "emoji" | "note" | "link" | "brain" | "image";

const field =
  "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-[0.8125rem] outline-none transition-colors placeholder:text-muted-foreground focus:border-border-strong [@media(pointer:coarse)]:text-base";

/** Everything on one idea besides its words: emoji, note, link, brain note, image, colour, side. */
export function Inspector({
  open,
  focus,
  onClose,
  doc,
  id,
  notes,
  uploading,
  onPatch,
  onImage,
  onOpenNote,
}: {
  open: boolean;
  focus?: InspectorFocus;
  onClose: () => void;
  doc: MapDoc;
  id: string;
  notes: { id: string; title: string }[];
  uploading: boolean;
  onPatch: (id: string, patch: NodePatch, merge?: string) => void;
  onImage: (id: string, file: File) => void;
  onOpenNote: (noteId: string) => void;
}) {
  const m = useMessages();
  const t = m.maps.inspector;
  const node = doc.nodes[id];
  return (
    <SidePanel open={open && !!node} title={node ? label(node) || m.maps.editor.placeholder : ""} onClose={onClose} closeLabel={t.close}>
      {node && <Body key={id} doc={doc} id={id} focus={focus} notes={notes} uploading={uploading} onPatch={onPatch} onImage={onImage} onOpenNote={onOpenNote} />}
    </SidePanel>
  );
}

function Body({
  doc,
  id,
  focus,
  notes,
  uploading,
  onPatch,
  onImage,
  onOpenNote,
}: {
  doc: MapDoc;
  id: string;
  focus?: InspectorFocus;
  notes: { id: string; title: string }[];
  uploading: boolean;
  onPatch: (id: string, patch: NodePatch, merge?: string) => void;
  onImage: (id: string, file: File) => void;
  onOpenNote: (noteId: string) => void;
}) {
  const m = useMessages();
  const t = m.maps.inspector;
  const e = m.maps.editor;
  const node = doc.nodes[id];
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-section="${focus}"]`);
    el?.scrollIntoView({ block: "nearest" });
    if (focus !== "emoji") el?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  }, [focus]);

  /* Link: checked when it is left, not at each letter. */
  const [link, setLink] = useState(node.link ?? "");
  const [linkError, setLinkError] = useState(false);
  useEffect(() => setLink(node.link ?? ""), [node.link]);
  const commitLink = () => {
    const v = link.trim();
    if (!v) {
      setLinkError(false);
      if (node.link) onPatch(id, { link: undefined });
      return;
    }
    const clean = cleanUrl(v);
    if (!clean) {
      setLinkError(true);
      return;
    }
    setLinkError(false);
    setLink(clean);
    if (clean !== node.link) onPatch(id, { link: clean });
  };

  /* Brain note. */
  const [noteQuery, setNoteQuery] = useState("");
  const [sending, setSending] = useState(false);
  const linked = node.noteId ? notes.find((n) => n.id === node.noteId) : undefined;
  const noteHits = useMemo(() => {
    const q = fold(noteQuery.trim());
    if (!q) return [];
    return notes.filter((n) => fold(n.title).includes(q)).slice(0, 8);
  }, [noteQuery, notes]);
  const sendToBrain = async () => {
    const title = label(node).trim();
    if (!title || sending) return;
    setSending(true);
    const res = await createNote({ title: title.slice(0, 500), detail: node.note ?? null, category: "ideas" }).catch(() => null);
    setSending(false);
    if (!res?.ok) {
      toast(m.maps.errors.failed, "error");
      return;
    }
    onPatch(id, { noteId: res.data.id });
    toast(t.brainSent);
  };

  /* Colour. */
  const theme = themeOf(doc.style);
  const parent = parentOf(doc, id);
  const mainIndex = parent === doc.root ? doc.nodes[doc.root].children.indexOf(id) : -1;
  const swatches = [...new Set(theme.palette)];
  const autoColor = id === doc.root ? theme.accent : mainIndex >= 0 ? branchColor(theme, doc.style, mainIndex) : undefined;

  const file = useRef<HTMLInputElement>(null);

  return (
    <div ref={root}>
      <Section title={e.emoji}>
        <div data-section="emoji">
          <EmojiPicker value={node.emoji} onPick={(v) => onPatch(id, { emoji: v })} autoFocus={focus === "emoji"} />
        </div>
      </Section>

      <Section title={e.note}>
        <div data-section="note">
          <textarea
            value={node.note ?? ""}
            onChange={(ev) => onPatch(id, { note: ev.target.value }, `note:${id}`)}
            placeholder={t.notePlaceholder}
            aria-label={e.note}
            rows={4}
            maxLength={20000}
            className={cn(field, "min-h-[6rem] resize-y leading-relaxed")}
          />
        </div>
      </Section>

      <Section title={e.link}>
        <div data-section="link" className="space-y-2">
          <div className="flex items-center gap-1.5">
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(ev) => {
                setLink(ev.target.value);
                setLinkError(false);
              }}
              onBlur={commitLink}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  commitLink();
                }
              }}
              placeholder={t.linkPlaceholder}
              aria-label={e.link}
              aria-invalid={linkError}
              className={cn(field, linkError && "border-red-500/70")}
            />
            {node.link && (
              <>
                <a
                  href={node.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t.linkOpen}
                  title={t.linkOpen}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setLink("");
                    onPatch(id, { link: undefined });
                  }}
                  aria-label={t.linkRemove}
                  title={t.linkRemove}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
          {linkError && <p className="text-[0.75rem] text-red-500">{t.linkInvalid}</p>}
        </div>
      </Section>

      <Section title={t.brain}>
        <div data-section="brain" className="space-y-2">
          {node.noteId ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 p-2 pl-3">
              <Brain className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{linked?.title ?? "…"}</span>
              <Button size="sm" variant="ghost" onClick={() => onOpenNote(node.noteId!)}>
                {t.brainOpen}
              </Button>
              <button
                type="button"
                onClick={() => onPatch(id, { noteId: undefined })}
                aria-label={t.brainUnlink}
                title={t.brainUnlink}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <Unlink className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 focus-within:border-border-strong">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={noteQuery}
                  onChange={(ev) => setNoteQuery(ev.target.value)}
                  placeholder={t.brainSearch}
                  aria-label={t.brainLink}
                  className="min-w-0 flex-1 bg-transparent py-2 text-[0.8125rem] outline-none placeholder:text-muted-foreground [@media(pointer:coarse)]:text-base"
                />
              </label>
              {noteQuery.trim() && (
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-border">
                  {noteHits.length ? (
                    noteHits.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onPatch(id, { noteId: n.id });
                            setNoteQuery("");
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] transition-colors hover:bg-surface-2"
                        >
                          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{n.title}</span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-2 text-[0.75rem] text-muted-foreground">{t.brainNone}</li>
                  )}
                </ul>
              )}
              <Button size="sm" variant="secondary" onClick={() => void sendToBrain()} disabled={!label(node).trim() || sending} className="w-full">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                {t.brainSend}
              </Button>
            </>
          )}
        </div>
      </Section>

      <Section title={e.image}>
        <div data-section="image" className="space-y-2">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              if (f) onImage(id, f);
              ev.target.value = "";
            }}
          />
          {node.image ? (
            <>
              <div className="overflow-hidden rounded-lg border border-border bg-background/60">
                {/* eslint-disable-next-line @next/next/no-img-element -- a private image served by LifeOS, not optimisable */}
                <img src={imageUrl(node.image.file)} alt={node.image.alt ?? ""} className="mx-auto max-h-40 w-auto object-contain" />
              </div>
              <input
                value={node.image.alt ?? ""}
                onChange={(ev) => onPatch(id, { image: { ...node.image!, alt: ev.target.value } }, `alt:${id}`)}
                placeholder={t.imageAlt}
                aria-label={t.imageAlt}
                maxLength={300}
                className={field}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => file.current?.click()} disabled={uploading} className="flex-1">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  {uploading ? t.imageUploading : t.imageReplace}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onPatch(id, { image: undefined })}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t.imageRemove}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => file.current?.click()} disabled={uploading} className="w-full">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                {uploading ? t.imageUploading : t.imageAdd}
              </Button>
              <p className="text-[0.75rem] leading-snug text-muted-foreground">{t.imageHint}</p>
            </>
          )}
        </div>
      </Section>

      <Section title={e.color}>
        <div role="radiogroup" aria-label={e.color} className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            role="radio"
            aria-checked={!node.color}
            onClick={() => onPatch(id, { color: undefined })}
            title={t.colorAuto}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[0.75rem] transition-colors",
              !node.color ? "border-foreground/60 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {autoColor && <span className="h-3.5 w-3.5 rounded-full" style={{ background: autoColor }} />}
            {t.colorAuto}
          </button>
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={node.color === c}
              aria-label={c}
              title={c}
              onClick={() => onPatch(id, { color: c })}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
                node.color === c ? "border-foreground" : "border-transparent"
              )}
              style={{ background: c }}
            />
          ))}
          <label
            title={t.colorCustom}
            className={cn(
              "relative grid h-8 w-8 cursor-pointer place-items-center overflow-hidden rounded-full border-2",
              node.color && !swatches.includes(node.color) ? "border-foreground" : "border-border"
            )}
            style={{ background: node.color && !swatches.includes(node.color) ? node.color : "conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)" }}
          >
            <span className="sr-only">{t.colorCustom}</span>
            <input
              type="color"
              value={node.color ?? autoColor ?? "#2563eb"}
              onChange={(ev) => onPatch(id, { color: ev.target.value }, `color:${id}`)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </Section>

      {parent === doc.root && doc.style.layout === "map" && (
        <Section title={t.side}>
          <Choice
            label={t.side}
            value={node.side ?? "auto"}
            options={[
              { value: "auto", label: t.sideAuto },
              { value: "left", label: t.left },
              { value: "right", label: t.right },
            ]}
            onChange={(v) => onPatch(id, { side: v === "auto" ? undefined : v })}
          />
        </Section>
      )}
    </div>
  );
}
