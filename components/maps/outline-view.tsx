"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { ChevronRight, FileText, Image as ImageIcon, Link2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Change, EditorState } from "@/lib/maps/history";
import { addChild, addSibling, indent, outdent, removeNodes, reorder, updateNode, type MapDoc, type MapNode } from "@/lib/maps/model";
import { branchColor, themeOf } from "@/lib/maps/theme";
import { EMOJI_FONT } from "@/lib/maps/draw";

/**
 * The map as an outline: every idea a line, indented under its parent. The
 * same document as the map — a change here is a change there — and the
 * quickest way to write a lot, or to read a map with a screen reader.
 *
 * Enter adds a line after, Tab and Shift+Tab move a line in and out,
 * Backspace on an empty line removes it, arrows move between lines,
 * Alt+arrows move a line up or down.
 */

interface Row {
  id: string;
  depth: number;
  color: string;
}

export function OutlineView({
  doc,
  selection,
  onSelect,
  change,
  roomFor,
  onToggle,
  labels,
}: {
  doc: MapDoc;
  selection: string[];
  onSelect: (ids: string[]) => void;
  change: (fn: (d: MapDoc, s: EditorState) => Change | null, merge?: string) => void;
  roomFor: (n: number) => boolean;
  onToggle: (id: string) => void;
  labels: { tree: string; placeholder: string; root: string; fold: string; unfold: string };
}) {
  const box = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const theme = themeOf(doc.style);
    const out: Row[] = [];
    const walk = (id: string, depth: number, color: string) => {
      const n = doc.nodes[id];
      const c = n.color ?? color;
      out.push({ id, depth, color: c });
      if (n.collapsed) return;
      n.children.forEach((k, i) => walk(k, depth + 1, depth === 0 ? (doc.nodes[k].color ?? branchColor(theme, doc.style, i)) : c));
    };
    walk(doc.root, 0, doc.nodes[doc.root].color ?? theme.accent);
    return out;
  }, [doc]);

  // The line selected (a new one, a moved one) takes the focus while the outline has it.
  const primary = selection[0];
  useEffect(() => {
    const el = box.current;
    if (!el || !primary || !el.contains(document.activeElement)) return;
    const field = el.querySelector<HTMLTextAreaElement>(`[data-row="${CSS.escape(primary)}"] textarea`);
    if (field && field !== document.activeElement) {
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
  }, [primary, rows]);

  const focusRow = (i: number, atEnd = true) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    const field = box.current?.querySelector<HTMLTextAreaElement>(`[data-row="${CSS.escape(r.id)}"] textarea`);
    if (!field) return;
    field.focus();
    const at = atEnd ? field.value.length : 0;
    field.setSelectionRange(at, at);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string, index: number) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const field = e.currentTarget;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!roomFor(1)) return;
      change((d) => {
        const r = id === d.root ? addChild(d, id) : addSibling(d, id);
        return { doc: r.doc, select: [r.id] };
      });
    } else if (e.key === "Tab") {
      e.preventDefault();
      change((d) => {
        const next = e.shiftKey ? outdent(d, id) : indent(d, id);
        return next === d ? null : { doc: next, select: [id] };
      });
    } else if (e.key === "Backspace" && field.value === "" && id !== doc.root && doc.nodes[id].children.length === 0) {
      e.preventDefault();
      change((d) => {
        if (!d.nodes[id]) return null;
        const r = removeNodes(d, [id]);
        return { doc: r.doc, select: [rows[index - 1]?.id ?? r.next] };
      });
      focusRow(index - 1);
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey) {
      e.preventDefault();
      change((d) => {
        const next = reorder(d, id, e.key === "ArrowUp" ? -1 : 1);
        return next === d ? null : { doc: next, select: [id] };
      });
    } else if (e.key === "ArrowUp" && !field.value.slice(0, field.selectionStart).includes("\n")) {
      e.preventDefault();
      focusRow(index - 1);
    } else if (e.key === "ArrowDown" && !field.value.slice(field.selectionEnd).includes("\n")) {
      e.preventDefault();
      focusRow(index + 1);
    } else if (e.key === "." && (e.ctrlKey || e.metaKey) && doc.nodes[id].children.length) {
      e.preventDefault();
      onToggle(id);
    }
  };

  // Handlers that stay the same from one render to the next, so a line that did not change is not drawn again.
  const latest = useRef({ onKey, onSelect, change, onToggle, selection });
  latest.current = { onKey, onSelect, change, onToggle, selection };
  const handlers = useMemo(
    () => ({
      focus: (id: string) => {
        const sel = latest.current.selection;
        if (sel[0] !== id || sel.length > 1) latest.current.onSelect([id]);
      },
      text: (id: string, text: string) => latest.current.change((d) => (d.nodes[id] ? { doc: updateNode(d, id, { text }) } : null), `text:${id}`),
      key: (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string, index: number) => latest.current.onKey(e, id, index),
      toggle: (id: string) => latest.current.onToggle(id),
    }),
    []
  );

  return (
    <div ref={box} className="h-full overflow-y-auto overscroll-contain">
      <div role="list" aria-label={labels.tree} className="mx-auto max-w-3xl px-3 pb-32 pt-6 sm:px-6">
        {rows.map((r, i) => (
          <OutlineRow
            key={r.id}
            row={r}
            index={i}
            node={doc.nodes[r.id]}
            selected={selection.includes(r.id)}
            placeholder={r.depth === 0 ? labels.root : labels.placeholder}
            foldLabel={doc.nodes[r.id].collapsed ? labels.unfold : labels.fold}
            on={handlers}
          />
        ))}
      </div>
    </div>
  );
}

interface RowHandlers {
  focus(id: string): void;
  text(id: string, text: string): void;
  key(e: React.KeyboardEvent<HTMLTextAreaElement>, id: string, index: number): void;
  toggle(id: string): void;
}

interface RowProps {
  row: Row;
  index: number;
  node: MapNode;
  selected: boolean;
  placeholder: string;
  foldLabel: string;
  on: RowHandlers;
}

const OutlineRow = memo(function OutlineRow({ row, index, node, selected, placeholder, foldLabel, on }: RowProps) {
  const onFocus = () => on.focus(row.id);
  const onText = (text: string) => on.text(row.id, text);
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => on.key(e, row.id, index);
  const onToggle = () => on.toggle(row.id);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = field.current;
    if (!t) return;
    t.style.height = "0px";
    t.style.height = `${t.scrollHeight}px`;
  }, [node.text]);
  const root = row.depth === 0;
  return (
    <div
      role="listitem"
      data-row={row.id}
      aria-level={row.depth + 1}
      className={cn("group relative flex items-start gap-1.5 rounded-lg py-0.5 pr-2 transition-colors", selected && "bg-surface-2/70")}
      style={{ paddingLeft: `${row.depth * 1.5 + 0.25}rem`, contentVisibility: "auto", containIntrinsicSize: "auto 36px" }}
    >
      {/* Guides: one line per level above. */}
      {Array.from({ length: row.depth }, (_, d) => (
        <span key={d} aria-hidden className="absolute bottom-0 top-0 w-px bg-border/70" style={{ left: `${d * 1.5 + 0.95}rem` }} />
      ))}
      <button
        type="button"
        onClick={onToggle}
        aria-label={foldLabel}
        aria-expanded={node.children.length ? !node.collapsed : undefined}
        disabled={!node.children.length}
        tabIndex={-1}
        className={cn(
          "mt-[0.4rem] grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-[transform,opacity,background] hover:bg-surface-2",
          !node.children.length && "pointer-events-none opacity-0"
        )}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !node.collapsed && "rotate-90")} />
      </button>
      <span
        aria-hidden
        className={cn("mt-[0.9rem] shrink-0 rounded-full", root ? "h-2.5 w-2.5" : "h-1.5 w-1.5", node.collapsed && "ring-2 ring-offset-1 ring-offset-background")}
        style={{ background: row.color, ...(node.collapsed ? { ["--tw-ring-color" as string]: row.color } : {}) }}
      />
      {node.emoji && (
        <span aria-hidden className={cn("shrink-0 py-1.5", root ? "text-[1.15rem] leading-6" : "text-[0.95rem] leading-6")} style={{ fontFamily: EMOJI_FONT }}>
          {node.emoji}
        </span>
      )}
      <textarea
        ref={field}
        value={node.text}
        rows={1}
        maxLength={1000}
        placeholder={placeholder}
        spellCheck
        aria-label={`${placeholder} · ${row.depth + 1}`}
        onFocus={onFocus}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={onKey}
        className={cn(
          "min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1.5 leading-6 outline-none placeholder:text-muted-foreground/60 focus-visible:outline-none [@media(pointer:coarse)]:text-base",
          root ? "text-[1.25rem] font-semibold tracking-tight" : row.depth === 1 ? "text-[0.9375rem] font-medium" : "text-[0.875rem]",
          node.ai && "italic text-muted-foreground"
        )}
      />
      <span className="mt-2.5 flex shrink-0 items-center gap-1 text-muted-foreground/70" aria-hidden>
        {node.note && <FileText className="h-3.5 w-3.5" />}
        {node.link && <Link2 className="h-3.5 w-3.5" />}
        {node.noteId && <Brain className="h-3.5 w-3.5" />}
        {node.image && <ImageIcon className="h-3.5 w-3.5" />}
      </span>
    </div>
  );
}, (a, b) =>
  a.row.id === b.row.id &&
  a.row.depth === b.row.depth &&
  a.row.color === b.row.color &&
  a.index === b.index &&
  a.node === b.node &&
  a.selected === b.selected &&
  a.placeholder === b.placeholder &&
  a.foldLabel === b.foldLabel &&
  a.on === b.on);
