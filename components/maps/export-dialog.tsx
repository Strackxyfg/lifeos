"use client";

import { useState } from "react";
import { Check, Copy, Download, FileCode2, FileImage, FileJson, FileText, FileType2, GitFork, ListTree, Loader2, Network, Workflow } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fromOutline, subtree, toOutline, type MapDoc } from "@/lib/maps/model";
import type { FontFamilies } from "@/lib/maps/theme";
import { exportText, fileStem, toNative, type TextExport } from "@/lib/maps/formats";
import { toXmind } from "@/lib/maps/formats/xmind";
import { PictureTooLarge, copyPng, download, exportPdf, exportPng, exportSvg, imageDataUrls, imageUrl } from "./client";
import { Modal } from "./modal";
import { Choice } from "./ui";

type Format = "png" | "svg" | "pdf" | "md" | "opml" | "mm" | "xmind" | "mermaid" | "json";

const PICTURES: Format[] = ["png", "svg", "pdf"];
const DATA: Format[] = ["md", "xmind", "mm", "opml", "mermaid", "json"];

const ICON: Record<Format, React.ReactNode> = {
  png: <FileImage className="h-4 w-4" />,
  svg: <FileCode2 className="h-4 w-4" />,
  pdf: <FileType2 className="h-4 w-4" />,
  md: <FileText className="h-4 w-4" />,
  opml: <ListTree className="h-4 w-4" />,
  mm: <GitFork className="h-4 w-4" />,
  xmind: <Network className="h-4 w-4" />,
  mermaid: <Workflow className="h-4 w-4" />,
  json: <FileJson className="h-4 w-4" />,
};

const TEXT: Partial<Record<Format, { kind: TextExport; ext: string; mime: string }>> = {
  md: { kind: "md", ext: "md", mime: "text/markdown;charset=utf-8" },
  opml: { kind: "opml", ext: "opml", mime: "text/x-opml;charset=utf-8" },
  mm: { kind: "mm", ext: "mm", mime: "application/x-freemind;charset=utf-8" },
  mermaid: { kind: "mermaid", ext: "mmd", mime: "text/plain;charset=utf-8" },
};

/** A map out of LifeOS: as a picture, or as a file another app opens. */
export function ExportDialog({
  open,
  onClose,
  doc,
  selection,
  families,
  title,
}: {
  open: boolean;
  onClose: () => void;
  doc: MapDoc;
  selection: string;
  families: FontFamilies;
  title: string;
}) {
  const m = useMessages();
  const t = m.maps.export;
  const [format, setFormat] = useState<Format>("png");
  const [scale, setScale] = useState<"1" | "2" | "3" | "4">("2");
  const [background, setBackground] = useState<"theme" | "none">("theme");
  const [scope, setScope] = useState<"all" | "branch">("all");
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);

  const branch = scope === "branch" && selection !== doc.root && !!doc.nodes[selection];
  const from = branch ? selection : doc.root;
  const only = branch ? new Set(subtree(doc, selection)) : undefined;
  const name = branch ? doc.nodes[selection].text.trim() || title : title;
  const stem = fileStem(name);
  const copyable = format === "png" || !!TEXT[format];

  const failed = (e: unknown) => {
    if (e instanceof PictureTooLarge) toast(fill(t.tooLarge, { scale }), "error");
    else toast(fill(t.failed, { reason: m.maps.errors.failed }), "error");
  };

  const run = async () => {
    setBusy("download");
    try {
      switch (format) {
        case "png":
          download(await exportPng(doc, families, { scale: Number(scale), background: background === "theme", only }), `${stem}.png`);
          break;
        case "svg":
          download(await exportSvg(doc, families, name, { background: background === "theme", only }), `${stem}.svg`, "image/svg+xml");
          break;
        case "pdf":
          download(await exportPdf(doc, families, name, { scale: 2, only }), `${stem}.pdf`);
          break;
        case "xmind": {
          const bytes = await toXmind(toOutline(doc, from), name, doc.style.layout, async (file) => {
            try {
              const res = await fetch(imageUrl(file));
              if (!res.ok) return null;
              return { bytes: new Uint8Array(await res.arrayBuffer()), ext: file.split(".").pop() ?? "png" };
            } catch {
              return null;
            }
          });
          download(new Blob([bytes as BlobPart], { type: "application/vnd.xmind.workbook" }), `${stem}.xmind`);
          break;
        }
        case "json": {
          const part = branch ? fromOutline(toOutline(doc, from), doc.style) : doc;
          const assets = Object.fromEntries(await imageDataUrls(part));
          download(JSON.stringify(toNative(part, name, assets), null, 1), `${stem}.lifeosmap.json`, "application/json");
          break;
        }
        default: {
          const spec = TEXT[format]!;
          download(exportText(doc, spec.kind, from), `${stem}.${spec.ext}`, spec.mime);
        }
      }
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    setBusy("copy");
    let ok = false;
    try {
      // Built in the click itself: Safari only lets a clipboard write started there through.
      if (format === "png") ok = await copyPng(exportPng(doc, families, { scale: Number(scale), background: background === "theme", only }));
      else {
        const spec = TEXT[format];
        if (spec) {
          await navigator.clipboard.writeText(exportText(doc, spec.kind, from));
          ok = true;
        }
      }
    } catch (e) {
      if (e instanceof PictureTooLarge) return failed(e);
      ok = false;
    } finally {
      setBusy(null);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else toast(fill(t.failed, { reason: m.maps.errors.failed }), "error");
  };

  const card = (f: Format) => {
    const on = f === format;
    return (
      <button
        key={f}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setFormat(f)}
        className={cn(
          "flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-[border-color,background]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
          on ? "border-accent bg-accent/10" : "border-border hover:border-border-strong hover:bg-surface-2/50"
        )}
      >
        <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", on ? "bg-accent text-accent-foreground" : "bg-surface-2 text-muted-foreground")}>{ICON[f]}</span>
        <span className="min-w-0">
          <span className="block text-[0.8125rem] font-medium">{t[f]}</span>
          <span className="block text-[0.6875rem] leading-snug text-muted-foreground">{t[`${f}Hint` as const]}</span>
        </span>
      </button>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t.title} wide closeLabel={m.maps.inspector.close}>
      <div className="space-y-5 p-5">
        <div>
          <p className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t.image}</p>
          <div role="radiogroup" aria-label={t.image} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PICTURES.map(card)}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t.data}</p>
          <div role="radiogroup" aria-label={t.data} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {DATA.map(card)}
          </div>
        </div>

        {selection !== doc.root || format === "png" || format === "svg" ? (
        <div className="grid gap-4 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-2">
          {selection !== doc.root && (
            <div className="space-y-1.5">
              <p className="text-[0.75rem] text-muted-foreground">{t.scope}</p>
              <Choice
                label={t.scope}
                value={scope}
                options={[
                  { value: "all", label: t.scopeAll },
                  { value: "branch", label: t.scopeBranch },
                ]}
                onChange={setScope}
              />
            </div>
          )}
          {format === "png" && (
            <div className="space-y-1.5">
              <p className="text-[0.75rem] text-muted-foreground">{t.scale}</p>
              <Choice label={t.scale} value={scale} options={(["1", "2", "3", "4"] as const).map((s) => ({ value: s, label: `${s}×` }))} onChange={setScale} />
            </div>
          )}
          {(format === "png" || format === "svg") && (
            <div className="space-y-1.5">
              <p className="text-[0.75rem] text-muted-foreground">{t.background}</p>
              <Choice
                label={t.background}
                value={background}
                options={[
                  { value: "theme", label: t.backgroundTheme },
                  { value: "none", label: t.backgroundNone },
                ]}
                onChange={setBackground}
              />
            </div>
          )}
        </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {copyable && (
            <Button variant="secondary" onClick={() => void copy()} disabled={!!busy}>
              {busy === "copy" ? <Loader2 className="h-4 w-4 animate-spin" /> : copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t.copied : format === "png" ? t.copyImage : t.copyText}
            </Button>
          )}
          <Button onClick={() => void run()} disabled={!!busy} data-autofocus>
            {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy === "download" ? t.exporting : `${t.title} · ${t[format]}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
