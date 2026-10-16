"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Download,
  HelpCircle,
  ListTree,
  Loader2,
  Maximize,
  Minus,
  MoreHorizontal,
  Network,
  Palette,
  PanelRight,
  Pencil,
  Plus,
  Redo2,
  Search,
  SmilePlus,
  Sparkles,
  Trash2,
  Undo2,
  X,
  CornerDownRight,
  AlertTriangle,
} from "lucide-react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { initialState, reduce, type Change, type EditorState } from "@/lib/maps/history";
import {
  LIMITS,
  MapLimitError,
  addChild,
  addSibling,
  duplicate,
  indent,
  insertOutlines,
  isInside,
  label,
  moveNode,
  nodeCount,
  outdent,
  parentIndex,
  parseDoc,
  removeNodes,
  reorder,
  reveal,
  search,
  setCollapsed,
  setStyle,
  settleProposals,
  showLevels,
  toOutline,
  updateNode,
  type MapDoc,
  type MapNode,
  type MapStyle,
  type NodePatch,
  type Outline,
} from "@/lib/maps/model";
import { layoutMap } from "@/lib/maps/layout";
import { DEFAULT_FAMILIES, type FontFamilies } from "@/lib/maps/theme";
import { neighbour, type Arrow } from "@/lib/maps/navigate";
import { parseIndented, toIndented } from "@/lib/maps/formats/outline";
import type { Measurer } from "@/lib/maps/measure";
import { loadMap, saveMap, type MapsCode } from "@/app/actions/maps";
import { MapCanvas, type CanvasHandle, type DropTarget } from "./map-canvas";
import { freshMeasurer, pageFamilies, sharedMeasurer, uploadImage } from "./client";
import { Floating, IconButton, Menu } from "./ui";
import { mapThumbnail } from "./preview";
import { Modal } from "./modal";
import { Inspector, type InspectorFocus } from "./inspector";
import { StylePanel } from "./style-panel";
import { ExportDialog } from "./export-dialog";
import { HelpDialog } from "./help-dialog";
import { OutlineView } from "./outline-view";

/**
 * A mind map, open: the map (or its outline), the tools around it, and the
 * saving no one has to think about — every change is kept within a second,
 * on this device first if LifeOS cannot be reached, and a map changed in
 * two places at once is never silently overwritten.
 */

export interface MapEditorProps {
  id: string;
  initial: { doc: MapDoc; revision: number; updatedAt: string; hasPreview: boolean };
  /** The brain's notes (id and title), to link an idea to one. */
  notes: { id: string; title: string }[];
  aiEnabled: boolean;
}

type SaveState =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "error"; code: MapsCode }
  | { kind: "conflict"; revision: number }
  | { kind: "missing" };

type Panel = { kind: "details"; focus?: InspectorFocus } | { kind: "style" } | null;
type Dialog = "export" | "help" | "conflict" | "draft" | null;

/* ── What stays on this device until LifeOS has it ────────────────── */

interface Draft {
  doc: MapDoc;
  base: number;
  at: number;
}
const draftKey = (id: string) => `lifeos.map.draft.${id}`;
function writeDraft(id: string, doc: MapDoc, base: number) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify({ doc, base, at: Date.now() }));
  } catch {
    /* storage full or blocked: the save itself still runs */
  }
}
function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as { doc?: unknown; base?: unknown; at?: unknown };
    const doc = parseDoc(v.doc);
    return doc && typeof v.base === "number" && typeof v.at === "number" ? { doc, base: v.base, at: v.at } : null;
  } catch {
    return null;
  }
}
function clearDraft(id: string) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* nothing to clear */
  }
}

const HINT_KEY = "lifeos.maps.hint.v1";

/** What was last copied from a map, with everything on it — pasted back whole if the text still matches. */
let clipboard: { text: string; outlines: Outline[] } | null = null;

/** An idea with nothing in it: no text, nothing attached, nothing under it. */
const blank = (n: MapNode | undefined) => !!n && !n.text.trim() && !n.emoji && !n.note && !n.link && !n.noteId && !n.image && n.children.length === 0;

/** The selected ideas that are not inside another selected one (what a copy or a move takes). */
function tops(doc: MapDoc, ids: string[]): string[] {
  return ids.filter((id) => doc.nodes[id] && !ids.some((o) => o !== id && isInside(doc, id, o)));
}

const outlineSize = (o: Outline): number => 1 + (o.children ?? []).reduce((s, c) => s + outlineSize(c), 0);

export default function MapEditor({ id, initial, notes, aiEnabled }: MapEditorProps) {
  const m = useMessages();
  const t = m.maps;
  const locale = useLocale();
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, initial.doc, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { doc, selection, editing } = state;
  const primary = selection[0] && doc.nodes[selection[0]] ? selection[0] : doc.root;

  const canvas = useRef<CanvasHandle>(null);
  const [view, setView] = useState<"map" | "outline">("map");
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [zoom, setZoom] = useState(1);
  const [touch, setTouch] = useState(false);
  const [hint, setHint] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState<string | null>(null);

  /* ── Fonts and layout ─────────────────────────────────────────────── */

  const [families, setFamilies] = useState<FontFamilies>(DEFAULT_FAMILIES);
  const [measurer, setMeasurer] = useState<Measurer>(() => sharedMeasurer());
  useEffect(() => {
    setFamilies(pageFamilies());
    let live = true;
    // Text measured before the webfont arrived is measured again with it.
    document.fonts?.ready.then(() => {
      if (live) setMeasurer(freshMeasurer());
    });
    setTouch(matchMedia("(pointer: coarse)").matches);
    try {
      setHint(!localStorage.getItem(HINT_KEY));
    } catch {
      /* no storage: no hint */
    }
    return () => {
      live = false;
    };
  }, []);
  const look = useRef({ families, measurer });
  look.current = { families, measurer };

  const layout = useMemo(() => layoutMap(doc, { families, measurer, placeholder: t.editor.placeholder }), [doc, families, measurer, t.editor.placeholder]);
  const parents = useMemo(() => parentIndex(doc), [doc]);

  /* ── Changing the map ─────────────────────────────────────────────── */

  const change = useCallback((fn: (d: MapDoc, s: EditorState) => Change | null, merge?: string) => {
    dispatch({
      type: "change",
      merge,
      at: Date.now(),
      fn: (d, s) => {
        try {
          return fn(d, s);
        } catch (e) {
          if (e instanceof MapLimitError) return null;
          throw e;
        }
      },
    });
  }, []);

  /** Whether `n` more ideas fit; says so when they do not. */
  const roomFor = useCallback(
    (n: number) => {
      if (nodeCount(stateRef.current.doc) + n <= LIMITS.nodes) return true;
      toast(fill(t.editor.limit, { n: LIMITS.nodes }), "error");
      return false;
    },
    [t.editor.limit]
  );

  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* fine */
    }
  }, []);

  const addIdea = useCallback(
    (how: "child" | "after" | "before", from?: string) => {
      if (!roomFor(1)) return;
      change((d, s) => {
        const at = from && d.nodes[from] ? from : s.selection[0] && d.nodes[s.selection[0]] ? s.selection[0] : d.root;
        const r = how === "child" || at === d.root ? addChild(d, at) : addSibling(d, at, "", how === "before");
        return { doc: r.doc, select: [r.id], edit: r.id };
      });
      dismissHint();
    },
    [change, roomFor, dismissHint]
  );

  const startEdit = useCallback((nid: string, replaceWith?: string) => {
    if (replaceWith !== undefined) {
      change((d) => (d.nodes[nid] ? { doc: updateNode(d, nid, { text: replaceWith }), select: [nid], edit: nid } : null), `text:${nid}`);
    } else dispatch({ type: "edit", id: nid });
  }, [change]);

  /** Typing done. An idea added and left empty goes, as if it had never been. */
  const endEdit = useCallback((nid: string) => {
    const s = stateRef.current;
    if (s.editing !== nid) return;
    const n = s.doc.nodes[nid];
    if (nid !== s.doc.root && blank(n)) {
      const next = removeNodes(s.doc, [nid]).next;
      for (let i = s.past.length - 1; i >= Math.max(0, s.past.length - 2); i--) {
        if (!s.past[i].nodes[nid]) {
          dispatch({ type: "revert", to: s.past[i], within: 2, select: [next] });
          return;
        }
      }
      change((d) => {
        if (!d.nodes[nid]) return null;
        const r = removeNodes(d, [nid]);
        return { doc: r.doc, select: [r.next], edit: null };
      });
      return;
    }
    dispatch({ type: "edit", id: null });
  }, [change]);

  const removeSelected = useCallback(() => {
    change((d, s) => {
      const ids = s.selection.filter((x) => x !== d.root);
      if (!ids.length) return null;
      const r = removeNodes(d, ids);
      return { doc: r.doc, select: [r.next], edit: null };
    });
  }, [change]);

  const toggle = useCallback(
    (nid: string) => {
      change((d, s) => {
        const n = d.nodes[nid];
        if (!n || !n.children.length) return null;
        const folding = !n.collapsed;
        // Folding away a selected idea selects the one it folds into.
        const select = folding ? [...new Set(s.selection.map((x) => (x !== nid && isInside(d, x, nid) ? nid : x)))] : s.selection;
        return { doc: setCollapsed(d, [nid], folding), select };
      });
    },
    [change]
  );

  const patch = useCallback(
    (nid: string, p: NodePatch, merge?: string) => change((d) => (d.nodes[nid] ? { doc: updateNode(d, nid, p) } : null), merge),
    [change]
  );

  const restyle = useCallback((p: Partial<MapStyle>) => change((d) => ({ doc: setStyle(d, p) })), [change]);

  const attachImage = useCallback(
    async (nid: string, file: Blob) => {
      setUploading((u) => [...u, nid]);
      const res = await uploadImage(file);
      setUploading((u) => u.filter((x) => x !== nid));
      if (!res.ok) {
        toast(
          res.code === "too_large" ? t.inspector.imageTooLarge : res.code === "invalid" ? t.inspector.imageInvalid : fill(t.editor.failed, { reason: t.errors[res.code] }),
          "error"
        );
        return;
      }
      change((d) => (d.nodes[nid] ? { doc: updateNode(d, nid, { image: { file: res.file, width: res.width, height: res.height } }) } : null));
    },
    [change, t]
  );

  const onMove = useCallback(
    (nid: string, to: DropTarget) => {
      change((d) => {
        const next = to.mode === "side" ? updateNode(d, nid, { side: to.side }) : moveNode(d, nid, to.parent, to.index, to.side);
        return next === d ? null : { doc: next, select: [nid] };
      });
    },
    [change]
  );

  const suggest = useCallback(
    async (nid: string) => {
      const d = stateRef.current.doc;
      const node = d.nodes[nid];
      if (!node || suggesting) return;
      if (!roomFor(1)) return;
      setSuggesting(nid);
      try {
        const path: string[] = [];
        for (let at: string | undefined = nid; at; at = parents.get(at)) path.unshift(label(d.nodes[at]));
        const res = await fetch("/api/maps/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, siblings: node.children.map((k) => label(d.nodes[k])), note: node.note ?? "", locale }),
        });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; ideas?: string[]; code?: string } | null;
        if (!res.ok || !body?.ok) {
          const code = body?.code;
          toast(code === "unavailable" ? t.ai.unavailable : code === "rate_limit" || res.status === 429 ? t.ai.limit : fill(t.ai.failed, { reason: t.errors.failed }), "error");
          return;
        }
        const ideas = (body.ideas ?? []).filter((x) => typeof x === "string" && x.trim());
        if (!ideas.length) {
          toast(t.ai.none);
          return;
        }
        const room = LIMITS.nodes - nodeCount(stateRef.current.doc);
        change((cur) => {
          if (!cur.nodes[nid]) return null;
          const r = insertOutlines(cur, nid, ideas.slice(0, Math.max(0, room)).map((text) => ({ text, ai: true })));
          return { doc: r.doc, select: [nid] };
        });
        toast(t.ai.hint);
      } catch {
        toast(fill(t.ai.failed, { reason: t.errors.network }), "error");
      } finally {
        setSuggesting(null);
      }
    },
    [change, locale, parents, roomFor, suggesting, t]
  );

  /* ── Saving ───────────────────────────────────────────────────────── */

  const saved = useRef({ doc: initial.doc, revision: initial.revision });
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const inflight = useRef(false);
  const blocked = useRef(false);
  const retry = useRef<{ timer: ReturnType<typeof setTimeout> | null; delay: number }>({ timer: null, delay: 0 });
  // A map with no picture in the gallery yet (made from a note) gets one with its first save.
  const lastPreview = useRef(initial.hasPreview ? 0 : -Infinity);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const flush = useCallback(async () => {
    if (inflight.current || blocked.current) return;
    const d = stateRef.current.doc;
    if (d === saved.current.doc) {
      setSave({ kind: "saved" });
      return;
    }
    if (retry.current.timer) clearTimeout(retry.current.timer);
    retry.current.timer = null;
    inflight.current = true;
    setSave({ kind: "saving" });
    writeDraft(id, d, saved.current.revision);
    let preview: string | undefined;
    if (Date.now() - lastPreview.current > 15_000) {
      try {
        preview = mapThumbnail(d, look.current.families, look.current.measurer);
        lastPreview.current = Date.now();
      } catch {
        preview = undefined;
      }
    }
    const res = await saveMap(id, { doc: d, preview }, saved.current.revision).catch(() => null);
    inflight.current = false;
    const again = () => {
      const delay = Math.min(30_000, Math.max(1500, retry.current.delay * 2));
      retry.current.delay = delay;
      retry.current.timer = setTimeout(() => void flushRef.current(), delay);
    };
    if (!res) {
      setSave({ kind: "offline" });
      again();
      return;
    }
    if (res.ok) {
      saved.current = { doc: d, revision: res.revision };
      retry.current.delay = 0;
      if (stateRef.current.doc !== d) {
        setSave({ kind: "pending" });
        retry.current.timer = setTimeout(() => void flushRef.current(), 400);
      } else {
        clearDraft(id);
        setSave({ kind: "saved" });
      }
      return;
    }
    if (res.code === "conflict") {
      blocked.current = true;
      setSave({ kind: "conflict", revision: res.revision ?? saved.current.revision });
      setDialog("conflict");
      return;
    }
    if (res.code === "missing") {
      blocked.current = true;
      setSave({ kind: "missing" });
      return;
    }
    setSave({ kind: "error", code: res.code });
    // LifeOS's side failing may pass; the rest waits for the next change.
    if (res.code === "failed") again();
  }, [id]);
  flushRef.current = flush;

  useEffect(() => {
    if (doc === saved.current.doc || blocked.current) return;
    setSave((s) => (s.kind === "saving" ? s : { kind: "pending" }));
    const timer = setTimeout(() => void flushRef.current(), 800);
    return () => clearTimeout(timer);
  }, [doc]);

  useEffect(() => {
    const unsaved = () => stateRef.current.doc !== saved.current.doc || inflight.current;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved()) return;
      writeDraft(id, stateRef.current.doc, saved.current.revision);
      e.preventDefault();
      e.returnValue = "";
    };
    const onHide = () => {
      if (document.visibilityState !== "hidden" || !unsaved()) return;
      writeDraft(id, stateRef.current.doc, saved.current.revision);
      void flushRef.current();
    };
    const onOnline = () => void flushRef.current();
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
      // Leaving for another page of LifeOS: what is not saved yet goes now.
      if (retry.current.timer) clearTimeout(retry.current.timer);
      if (stateRef.current.doc !== saved.current.doc && !blocked.current) {
        writeDraft(id, stateRef.current.doc, saved.current.revision);
        void flushRef.current();
      }
    };
  }, [id]);

  // A map that has no picture yet gets one now, once the page's fonts are measured.
  useEffect(() => {
    if (initial.hasPreview) return;
    const timer = setTimeout(() => {
      if (stateRef.current.doc !== saved.current.doc || inflight.current || blocked.current) return;
      const d = saved.current.doc;
      let preview: string | undefined;
      try {
        preview = mapThumbnail(d, look.current.families, look.current.measurer);
      } catch {
        return;
      }
      if (!preview) return;
      inflight.current = true;
      void saveMap(id, { doc: d, preview }, saved.current.revision)
        .then((res) => {
          if (res.ok) {
            saved.current = { ...saved.current, revision: res.revision };
            lastPreview.current = Date.now();
          }
        })
        .catch(() => {})
        .finally(() => {
          inflight.current = false;
          // A change made meanwhile waited for this save: it goes now.
          if (stateRef.current.doc !== saved.current.doc) void flushRef.current();
        });
    }, 1500);
    return () => clearTimeout(timer);
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A draft left on this device by a session that could not save.
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const d = readDraft(id);
    if (!d) return;
    if (JSON.stringify(d.doc) === JSON.stringify(initial.doc)) {
      clearDraft(id);
      return;
    }
    setDraft(d);
    setDialog("draft");
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const keepMine = () => {
    if (save.kind !== "conflict") return;
    saved.current = { ...saved.current, revision: save.revision };
    blocked.current = false;
    setDialog(null);
    void flush();
  };
  const loadTheirs = async () => {
    const res = await loadMap(id).catch(() => null);
    if (!res?.ok) {
      toast(fill(t.editor.failed, { reason: t.errors[res ? res.code : "network"] }), "error");
      return;
    }
    saved.current = { doc: res.doc, revision: res.revision };
    blocked.current = false;
    clearDraft(id);
    dispatch({ type: "replace", doc: res.doc });
    setSave({ kind: "saved" });
    setDialog(null);
  };

  /* ── Search ───────────────────────────────────────────────────────── */

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => (query.trim() ? search(doc, query) : []), [doc, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const currentMatch = matches.length ? matches[Math.min(hit, matches.length - 1)] : null;
  const centerOn = useRef<string | null>(null);
  /** The match last brought into view: Enter shows the current one first, then the next. */
  const shown = useRef<string | null>(null);

  const goTo = useCallback(
    (i: number) => {
      if (!matches.length) return;
      const k = ((i % matches.length) + matches.length) % matches.length;
      setHit(k);
      const target = matches[k];
      shown.current = target;
      change((d) => {
        const opened = reveal(d, target);
        return { doc: opened, select: [target] };
      });
      centerOn.current = target;
    },
    [change, matches]
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchInput.current?.select());
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setHit(0);
    canvas.current?.focus();
  }, []);

  /** What an open panel covers of the map: the bottom on a phone, the right side on a larger screen. */
  const covered = useCallback(
    (): { right?: number; bottom?: number } => (!panel ? {} : window.innerWidth < 640 ? { bottom: Math.min(window.innerHeight * 0.64, 544) } : { right: 340 }),
    [panel]
  );
  // A panel that opens over the selected idea moves the map aside.
  useEffect(() => {
    if (panel && view === "map") requestAnimationFrame(() => canvas.current?.reveal(stateRef.current.selection[0] ?? stateRef.current.doc.root, covered()));
  }, [panel, view, covered]);

  // A new layout moves everything: the whole map is shown again.
  const shownLayout = useRef(doc.style.layout);
  useEffect(() => {
    if (shownLayout.current === doc.style.layout) return;
    shownLayout.current = doc.style.layout;
    requestAnimationFrame(() => canvas.current?.fit());
  }, [doc.style.layout]);

  // Keep the selected idea in view when it changes or moves (not when the map is moved by hand); centre what was searched for.
  const lastReveal = useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (view !== "map") {
      lastReveal.current = null;
      return;
    }
    const c = centerOn.current;
    if (c && layout.boxes.has(c)) {
      centerOn.current = null;
      canvas.current?.center(c);
    }
    const b = layout.boxes.get(primary);
    if (!b) return;
    const l = lastReveal.current;
    // The first time, the map fits the screen by itself.
    if (l && !c && (l.id !== primary || l.x !== b.x || l.y !== b.y || l.w !== b.w || l.h !== b.h)) canvas.current?.reveal(primary, covered());
    lastReveal.current = { id: primary, x: b.x, y: b.y, w: b.w, h: b.h };
  }, [layout, primary, view, covered]);

  /* ── Keyboard ─────────────────────────────────────────────────────── */

  const focusCanvas = useCallback(() => requestAnimationFrame(() => canvas.current?.focus()), []);

  const onEditKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, nid: string) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        focusCanvas();
        return;
      }
      const s = stateRef.current;
      const n = s.doc.nodes[nid];
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (blank(n) || mod) {
          endEdit(nid);
          focusCanvas();
          return;
        }
        addIdea(nid === s.doc.root ? "child" : "after", nid);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (blank(n) && nid !== s.doc.root) {
          // A new empty idea: Tab moves it in a level, Shift+Tab out.
          change((d) => {
            const moved = e.shiftKey ? outdent(d, nid) : indent(d, nid);
            return moved === d ? null : { doc: moved, select: [nid], edit: nid };
          });
          return;
        }
        if (e.shiftKey) {
          change((d) => {
            const moved = outdent(d, nid);
            return moved === d ? null : { doc: moved, select: [nid], edit: nid };
          });
          return;
        }
        addIdea("child", nid);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endEdit(nid);
        focusCanvas();
      }
    },
    [addIdea, change, endEdit, focusCanvas]
  );

  const selectAll = useCallback(() => dispatch({ type: "select", ids: [...layout.order] }), [layout.order]);

  const onCanvasKey = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      if (e.nativeEvent.isComposing) return;
      const s = stateRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const at = s.selection[0] && s.doc.nodes[s.selection[0]] ? s.selection[0] : s.doc.root;
      const arrows: Record<string, Arrow> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      const arrow = arrows[e.key];
      if (arrow) {
        e.preventDefault();
        if (e.altKey) {
          const delta = arrow === "up" || arrow === "left" ? -1 : 1;
          change((d) => {
            const moved = reorder(d, at, delta);
            return moved === d ? null : { doc: moved, select: [at] };
          });
          return;
        }
        const next = neighbour(s.doc, layout, parents, at, arrow);
        if (next) dispatch({ type: "select", ids: e.shiftKey ? [next, ...s.selection.filter((x) => x !== next)] : [next] });
        return;
      }
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === "d") {
          e.preventDefault();
          if (at === s.doc.root || !roomFor(1)) return;
          change((d) => {
            const r = duplicate(d, at);
            return { doc: r.doc, select: [r.id] };
          });
        } else if (k === "a") {
          e.preventDefault();
          selectAll();
        } else if (k === "enter") {
          e.preventDefault();
          startEdit(at);
        }
        return;
      }
      switch (e.key) {
        case "Tab":
          if (e.shiftKey) return; // Shift+Tab leaves the map, back to the tools.
          e.preventDefault();
          addIdea("child", at);
          return;
        case "Enter":
          e.preventDefault();
          addIdea(e.shiftKey ? "before" : "after", at);
          return;
        case "F2":
          e.preventDefault();
          startEdit(at);
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeSelected();
          return;
        case " ":
          e.preventDefault();
          for (const x of s.selection) toggle(x);
          return;
        case "Home":
          e.preventDefault();
          dispatch({ type: "select", ids: [s.doc.root] });
          centerOn.current = s.doc.root;
          canvas.current?.center(s.doc.root);
          return;
        case "Escape":
          if (searchOpen) closeSearch();
          else if (panel) setPanel(null);
          else dispatch({ type: "select", ids: [s.doc.root] });
          return;
      }
      // Typing on a selected idea writes over it, as in a spreadsheet cell.
      if (e.key.length === 1 && !e.altKey && e.key !== " ") {
        e.preventDefault();
        startEdit(at, e.key);
      }
    },
    [addIdea, change, closeSearch, layout, panel, parents, removeSelected, roomFor, searchOpen, selectAll, startEdit, toggle]
  );

  // Keys that work anywhere on the page (not while typing in a field of the tools).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const el = e.target as HTMLElement | null;
      const ours = !!el?.closest?.("[data-map-edit]");
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) && !ours;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "f") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (typing || ours) return;
      if (mod && (k === "z" || k === "y")) {
        e.preventDefault();
        dispatch({ type: k === "y" || e.shiftKey ? "redo" : "undo" });
      } else if (mod && k === "0") {
        e.preventDefault();
        canvas.current?.fit();
      } else if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        canvas.current?.zoomBy(1.25);
      } else if (mod && k === "-") {
        e.preventDefault();
        canvas.current?.zoomBy(0.8);
      } else if (e.key === "?" && !mod) {
        e.preventDefault();
        setDialog("help");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  // Copy, cut and paste on the map: the system clipboard, as indented text any app reads.
  useEffect(() => {
    const onMap = () => !!(document.activeElement as HTMLElement | null)?.closest?.("[data-map-canvas]");
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (!onMap() || !e.clipboardData) return;
      const s = stateRef.current;
      const ids = tops(s.doc, s.selection);
      if (!ids.length) return;
      const outlines = ids.map((x) => toOutline(s.doc, x));
      const text = outlines.map((o) => toIndented(o)).join("\n");
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      clipboard = { text, outlines };
      if (cut) removeSelected();
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (!onMap() || !e.clipboardData) return;
      const s = stateRef.current;
      const at = s.selection[0] && s.doc.nodes[s.selection[0]] ? s.selection[0] : s.doc.root;
      const image = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
      if (image) {
        e.preventDefault();
        void attachImage(at, image);
        return;
      }
      const text = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
      if (!text.trim()) return;
      e.preventDefault();
      const outlines = clipboard && clipboard.text === text ? clipboard.outlines : parseIndented(text);
      if (!outlines.length || !roomFor(outlines.reduce((n, o) => n + outlineSize(o), 0))) return;
      change((d) => {
        const r = insertOutlines(d, d.nodes[at] ? at : d.root, outlines);
        return r.ids.length ? { doc: r.doc, select: r.ids } : null;
      });
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [attachImage, change, removeSelected, roomFor]);

  /* ── Opening what is attached to an idea ──────────────────────────── */

  const onIcon = useCallback(
    async (nid: string, kind: "note" | "link" | "brain") => {
      const n = stateRef.current.doc.nodes[nid];
      if (!n) return;
      dispatch({ type: "select", ids: [nid] });
      if (kind === "note") setPanel({ kind: "details", focus: "note" });
      else if (kind === "link" && n.link) window.open(n.link, "_blank", "noopener,noreferrer");
      else if (kind === "brain" && n.noteId) {
        await flushRef.current();
        router.push(`/brain?note=${encodeURIComponent(n.noteId)}`);
      }
    },
    [router]
  );

  /* ── Rendering ────────────────────────────────────────────────────── */

  const node = doc.nodes[primary];
  const proposals = selection.filter((x) => doc.nodes[x]?.ai);
  const childProposals = node ? node.children.filter((k) => doc.nodes[k]?.ai) : [];
  const settle = (accept: boolean) => {
    const ids = proposals.length ? proposals : childProposals;
    change((d) => {
      const next = settleProposals(d, ids, accept);
      return next === d ? null : { doc: next, select: accept ? ids.filter((x) => next.nodes[x]) : [primary && next.nodes[primary] ? primary : d.root] };
    });
  };
  const title = label(doc.nodes[doc.root]) || t.editor.rootPlaceholder;
  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;
  const total = Object.keys(doc.nodes).length;

  const status = (() => {
    switch (save.kind) {
      case "saved":
        return { text: t.editor.saved, icon: <Check className="h-3.5 w-3.5" />, tone: "muted" as const };
      case "pending":
        return { text: t.editor.unsaved, icon: <span className="h-1.5 w-1.5 rounded-full bg-current" />, tone: "muted" as const };
      case "saving":
        return { text: t.editor.saving, icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, tone: "muted" as const };
      case "offline":
        return { text: t.editor.offline, icon: <CloudOff className="h-3.5 w-3.5" />, tone: "warn" as const };
      case "error":
        return { text: fill(t.editor.failed, { reason: t.errors[save.code] }), icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "bad" as const };
      case "conflict":
        return { text: t.errors.conflict, icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "bad" as const };
      case "missing":
        return { text: t.editor.missing, icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "bad" as const };
    }
  })();

  const moreItems = [
    { id: "view", label: view === "map" ? t.editor.view.outline : t.editor.view.map, icon: view === "map" ? <ListTree className="h-4 w-4" /> : <Network className="h-4 w-4" />, onSelect: () => setView(view === "map" ? "outline" : "map") },
    { id: "style", label: t.editor.style, icon: <Palette className="h-4 w-4" />, onSelect: () => setPanel({ kind: "style" }) },
    { id: "export", label: t.editor.export, icon: <Download className="h-4 w-4" />, onSelect: () => setDialog("export") },
    "separator" as const,
    { id: "help", label: t.editor.help, icon: <HelpCircle className="h-4 w-4" />, onSelect: () => setDialog("help") },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="relative z-[70] flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur sm:gap-2 sm:px-3">
        <Link
          href="/brain/maps"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80 [@media(pointer:coarse)]:h-11"
          aria-label={t.editor.back}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden md:inline">{t.editor.back}</span>
        </Link>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              setView("map");
              startEdit(doc.root);
            }}
            className="group flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
            title={t.editor.title}
          >
            <span className="truncate text-[0.9375rem] font-medium tracking-tight">{title}</span>
            <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "flex items-center gap-1 px-1.5 text-[0.6875rem] leading-tight",
              status.tone === "muted" && "text-muted-foreground",
              status.tone === "warn" && "text-amber-500",
              status.tone === "bad" && "text-red-500"
            )}
          >
            {status.icon}
            <span className="truncate">{status.text}</span>
            <span className="hidden text-muted-foreground sm:inline">· {plural(locale, total, m.maps.gallery.ideas)}</span>
          </p>
        </div>

        <IconButton label={t.editor.undo} onClick={() => dispatch({ type: "undo" })} disabled={!canUndo}>
          <Undo2 className="h-4 w-4" />
        </IconButton>
        <IconButton label={t.editor.redo} onClick={() => dispatch({ type: "redo" })} disabled={!canRedo}>
          <Redo2 className="h-4 w-4" />
        </IconButton>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <IconButton label={t.editor.search} onClick={() => (searchOpen ? closeSearch() : openSearch())} active={searchOpen}>
          <Search className="h-4 w-4" />
        </IconButton>
        <div className="hidden items-center gap-1 sm:flex">
          <div role="radiogroup" aria-label={t.editor.view.map} className="flex items-center rounded-lg border border-border bg-background/60 p-0.5">
            {(["map", "outline"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.75rem] transition-colors",
                  view === v ? "bg-surface-2 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v === "map" ? <Network className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}
                {t.editor.view[v]}
              </button>
            ))}
          </div>
          <IconButton label={t.editor.style} onClick={() => setPanel(panel?.kind === "style" ? null : { kind: "style" })} active={panel?.kind === "style"}>
            <Palette className="h-4 w-4" />
          </IconButton>
          <IconButton label={t.editor.help} onClick={() => setDialog("help")}>
            <HelpCircle className="h-4 w-4" />
          </IconButton>
          <Button size="sm" variant="primary" onClick={() => setDialog("export")} className="ml-1">
            <Download className="h-3.5 w-3.5" />
            {t.editor.export}
          </Button>
        </div>
        <Menu className="sm:hidden" label={t.editor.details} icon={<MoreHorizontal className="h-4 w-4" />} items={moreItems} />

        {/* Search, under the bar. */}
        {searchOpen && (
          <div className="absolute inset-x-2 top-full mt-2 flex justify-end sm:left-auto sm:right-3">
            <Floating className="flex w-full items-center gap-1 p-1.5 sm:w-[24rem]">
              <Search className="ml-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchInput}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHit(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const at = Math.min(hit, matches.length - 1);
                    goTo(shown.current === matches[at] ? at + (e.shiftKey ? -1 : 1) : at);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeSearch();
                  }
                }}
                placeholder={t.editor.searchPlaceholder}
                aria-label={t.editor.search}
                className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[0.875rem] outline-none placeholder:text-muted-foreground [@media(pointer:coarse)]:text-base"
              />
              <span className="shrink-0 px-1 font-mono text-[0.6875rem] text-muted-foreground" aria-live="polite">
                {query.trim() ? (matches.length ? `${Math.min(hit, matches.length - 1) + 1}/${matches.length}` : t.editor.noResult) : ""}
              </span>
              <IconButton label={t.editor.previous} onClick={() => goTo(hit - 1)} disabled={!matches.length}>
                <ChevronUp className="h-4 w-4" />
              </IconButton>
              <IconButton label={t.editor.next} onClick={() => goTo(hit + 1)} disabled={!matches.length}>
                <ChevronDown className="h-4 w-4" />
              </IconButton>
              <IconButton label={t.inspector.close} onClick={closeSearch}>
                <X className="h-4 w-4" />
              </IconButton>
            </Floating>
          </div>
        )}
      </header>

      {/* ── The map ── */}
      <div className="relative min-h-0 flex-1">
        {view === "map" ? (
          <MapCanvas
            ref={canvas}
            doc={doc}
            layout={layout}
            selection={selection}
            editing={editing}
            matches={matchSet}
            current={currentMatch}
            treeLabel={t.editor.canvas}
            editLabel={t.editor.edit}
            placeholder={primary === doc.root ? t.editor.rootPlaceholder : t.editor.placeholder}
            onSelect={(ids) => dispatch({ type: "select", ids })}
            onEdit={(nid) => startEdit(nid)}
            onText={(nid, text) => patch(nid, { text }, `text:${nid}`)}
            onEditKey={onEditKey}
            onEditBlur={(nid) => {
              // Switching to another window keeps the idea open for typing.
              if (typeof document !== "undefined" && !document.hasFocus()) return;
              endEdit(nid);
            }}
            onToggle={toggle}
            onMove={onMove}
            onImage={(nid, file) => void attachImage(nid, file)}
            onIcon={(nid, kind) => void onIcon(nid, kind)}
            onZoom={setZoom}
            onBackground={() => {
              if (stateRef.current.editing) endEdit(stateRef.current.editing);
            }}
            onKeyDown={onCanvasKey}
          />
        ) : (
          <OutlineView
            doc={doc}
            selection={selection}
            onSelect={(ids) => dispatch({ type: "select", ids })}
            change={change}
            roomFor={roomFor}
            onToggle={toggle}
            labels={{ tree: t.editor.outlineLabel, placeholder: t.editor.placeholder, root: t.editor.rootPlaceholder, fold: t.editor.fold, unfold: t.editor.unfold }}
          />
        )}

        {/* What can be done to the selected idea. */}
        {node && !editing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[50] flex justify-center px-2">
            <Floating role="toolbar" aria-label={label(node) || t.editor.placeholder} className="flex max-w-full items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]">
              {proposals.length > 0 || childProposals.length > 0 ? (
                <>
                  <span className="flex items-center gap-1.5 px-2 text-[0.75rem] text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t.inspector.proposals}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => settle(true)}>
                    <Check className="h-3.5 w-3.5" />
                    {t.inspector.keep}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => settle(false)}>
                    <X className="h-3.5 w-3.5" />
                    {t.inspector.dismiss}
                  </Button>
                  <span className="mx-1 h-5 w-px shrink-0 bg-border" />
                </>
              ) : null}
              <IconButton label={t.editor.addChild} onClick={() => addIdea("child", primary)}>
                <CornerDownRight className="h-4 w-4" />
              </IconButton>
              <IconButton label={t.editor.addSibling} onClick={() => addIdea("after", primary)} disabled={primary === doc.root}>
                <Plus className="h-4 w-4" />
              </IconButton>
              <IconButton label={t.editor.edit} onClick={() => (view === "map" ? startEdit(primary) : setPanel({ kind: "details" }))}>
                <Pencil className="h-4 w-4" />
              </IconButton>
              <IconButton label={t.editor.emoji} onClick={() => setPanel({ kind: "details", focus: "emoji" })}>
                <SmilePlus className="h-4 w-4" />
              </IconButton>
              <IconButton label={t.editor.details} onClick={() => setPanel(panel?.kind === "details" ? null : { kind: "details" })} active={panel?.kind === "details"}>
                <PanelRight className="h-4 w-4" />
              </IconButton>
              {node.children.length > 0 && (
                <IconButton label={node.collapsed ? t.editor.unfold : t.editor.fold} onClick={() => toggle(primary)}>
                  {node.collapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
                </IconButton>
              )}
              {aiEnabled && (
                <IconButton label={suggesting ? t.ai.suggesting : t.ai.suggest} onClick={() => void suggest(primary)} disabled={!!suggesting}>
                  {suggesting === primary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </IconButton>
              )}
              {uploading.includes(primary) && (
                <span className="flex items-center gap-1.5 px-2 text-[0.75rem] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t.inspector.imageUploading}
                </span>
              )}
              <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
              <IconButton label={t.editor.delete} tone="danger" onClick={removeSelected} disabled={selection.every((x) => x === doc.root)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
              {selection.length > 1 && (
                <span className="whitespace-nowrap px-2 text-[0.75rem] text-muted-foreground">{plural(locale, selection.length, t.editor.selected)}</span>
              )}
            </Floating>
          </div>
        )}

        {/* Zoom. */}
        {view === "map" && (
          <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-[40] hidden md:block">
            <Floating className="flex items-center gap-0.5 p-1">
              <IconButton label={t.editor.zoomOut} onClick={() => canvas.current?.zoomBy(0.8)}>
                <Minus className="h-4 w-4" />
              </IconButton>
              <button
                type="button"
                onClick={() => canvas.current?.setZoom(1)}
                className="h-9 min-w-[3.25rem] rounded-lg px-1 font-mono text-[0.75rem] tabular-nums text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                title="100 %"
              >
                {Math.round(zoom * 100)}%
              </button>
              <IconButton label={t.editor.zoomIn} onClick={() => canvas.current?.zoomBy(1.25)}>
                <Plus className="h-4 w-4" />
              </IconButton>
              <IconButton label={t.editor.fit} onClick={() => canvas.current?.fit()}>
                <Maximize className="h-4 w-4" />
              </IconButton>
            </Floating>
          </div>
        )}
        {view === "map" && (
          <div className="pointer-events-none absolute right-3 top-3 z-[40] md:hidden">
            <Floating className="p-0.5">
              <IconButton label={t.editor.fit} onClick={() => canvas.current?.fit()}>
                <Maximize className="h-4 w-4" />
              </IconButton>
            </Floating>
          </div>
        )}

        {/* The first time: how to work the map. */}
        {hint && view === "map" && !panel && (
          <div className="pointer-events-none absolute left-3 top-3 z-[40] max-w-[min(22rem,calc(100%-5rem))]">
            <Floating className="flex items-start gap-2 p-3 pr-1.5">
              <p className="text-[0.8125rem] leading-snug text-muted-foreground">{touch ? t.editor.hintTouch : t.editor.hint}</p>
              <IconButton label={t.inspector.close} onClick={dismissHint} className="-mt-1">
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </Floating>
          </div>
        )}

        {save.kind === "missing" && (
          <div className="absolute inset-x-3 top-3 z-[80] flex justify-center">
            <Floating className="flex items-center gap-3 p-3 text-[0.8125rem]">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              {t.editor.missing}
              <Link href="/brain/maps" className="font-medium underline underline-offset-4">
                {t.editor.back}
              </Link>
            </Floating>
          </div>
        )}

        <Inspector
          open={panel?.kind === "details"}
          focus={panel?.kind === "details" ? panel.focus : undefined}
          onClose={() => setPanel(null)}
          doc={doc}
          id={primary}
          notes={notes}
          uploading={uploading.includes(primary)}
          onPatch={patch}
          onImage={(nid, file) => void attachImage(nid, file)}
          onOpenNote={(noteId) => {
            void flushRef.current().then(() => router.push(`/brain?note=${encodeURIComponent(noteId)}`));
          }}
        />
        <StylePanel open={panel?.kind === "style"} onClose={() => setPanel(null)} doc={doc} families={families} onStyle={restyle} onLevels={(n) => change((d) => ({ doc: n === 0 ? setCollapsed(d, Object.keys(d.nodes), false) : showLevels(d, n) }))} />
      </div>

      <ExportDialog open={dialog === "export"} onClose={() => setDialog(null)} doc={doc} selection={primary} families={families} title={title} />
      <HelpDialog open={dialog === "help"} onClose={() => setDialog(null)} />

      <Modal open={dialog === "conflict"} onClose={() => setDialog(null)} title={t.editor.conflictTitle} closeLabel={t.inspector.close}>
        <div className="space-y-4 p-5">
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">{t.editor.conflictBody}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => void loadTheirs()}>
              {t.editor.loadTheirs}
            </Button>
            <Button onClick={keepMine} data-autofocus>
              {t.editor.keepMine}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={dialog === "draft"}
        onClose={() => {
          setDialog(null);
          setDraft(null);
        }}
        title={t.editor.draftTitle}
        closeLabel={t.inspector.close}
      >
        <div className="space-y-4 p-5">
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">{t.editor.draftBody}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                clearDraft(id);
                setDraft(null);
                setDialog(null);
              }}
            >
              {t.editor.discard}
            </Button>
            <Button
              data-autofocus
              onClick={() => {
                if (draft) dispatch({ type: "replace", doc: draft.doc });
                setDraft(null);
                setDialog(null);
              }}
            >
              {t.editor.restore}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
