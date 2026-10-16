import type { MapDoc } from "./model";

/**
 * The editor's memory: the document, what came before (undo) and after
 * (redo), and what is selected. Keystrokes in one idea within a moment of
 * each other are one step of undo, not one per letter.
 */

export interface EditorState {
  doc: MapDoc;
  past: MapDoc[];
  future: MapDoc[];
  selection: string[];
  /** The idea whose text is being typed, if any. */
  editing: string | null;
  /** The last change's key and time, to merge a burst of typing into one step. */
  last: { key: string; at: number } | null;
}

/** What a change gives: the new document, and what to select or edit in it. */
export interface Change {
  doc: MapDoc;
  select?: string[];
  edit?: string | null;
}

export type EditorAction =
  | { type: "apply"; doc: MapDoc; select?: string[]; edit?: string | null; merge?: string; at?: number }
  /**
   * A change computed from the document as it is when it lands — never from
   * a copy that a change just before may have outdated. `fn` must be pure
   * (React may call it twice); null changes nothing.
   */
  | { type: "change"; fn: (doc: MapDoc, s: EditorState) => Change | null; merge?: string; at?: number }
  /**
   * Back to `to`, a version still in the history, as if what came after had
   * never happened (an idea added then left empty): nothing to redo. Only
   * within the last `within` steps; otherwise nothing changes.
   */
  | { type: "revert"; to: MapDoc; within: number; select?: string[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; ids: string[] }
  | { type: "edit"; id: string | null }
  /** Another version replaces this one (loaded from elsewhere): history is kept, so it can be undone. */
  | { type: "replace"; doc: MapDoc };

export const HISTORY = 200;
const MERGE_MS = 1200;

export function initialState(doc: MapDoc): EditorState {
  return { doc, past: [], future: [], selection: [doc.root], editing: null, last: null };
}

/** A selection keeps only ideas that still exist (an undo may have taken one away). */
const valid = (doc: MapDoc, ids: string[]) => {
  const kept = ids.filter((i) => doc.nodes[i]);
  return kept.length ? kept : [doc.root];
};

export function reduce(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "apply": {
      if (a.doc === s.doc) {
        return { ...s, selection: a.select ? valid(s.doc, a.select) : s.selection, editing: a.edit !== undefined ? a.edit : s.editing };
      }
      const at = a.at ?? Date.now();
      const merging = !!a.merge && s.last?.key === a.merge && at - s.last.at < MERGE_MS && s.past.length > 0;
      const past = merging ? s.past : [...s.past, s.doc].slice(-HISTORY);
      return {
        doc: a.doc,
        past,
        future: [],
        selection: valid(a.doc, a.select ?? s.selection),
        editing: a.edit !== undefined ? a.edit : s.editing && a.doc.nodes[s.editing] ? s.editing : null,
        last: a.merge ? { key: a.merge, at } : null,
      };
    }
    case "change": {
      const r = a.fn(s.doc, s);
      return r ? reduce(s, { type: "apply", ...r, merge: a.merge, at: a.at }) : s;
    }
    case "revert": {
      const i = s.past.lastIndexOf(a.to);
      if (i < 0 || s.past.length - i > a.within) return s;
      return { ...s, doc: a.to, past: s.past.slice(0, i), selection: valid(a.to, a.select ?? s.selection), editing: null, last: null };
    }
    case "undo": {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { ...s, doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY), selection: valid(prev, s.selection), editing: null, last: null };
    }
    case "redo": {
      const next = s.future[0];
      if (!next) return s;
      return { ...s, doc: next, past: [...s.past, s.doc].slice(-HISTORY), future: s.future.slice(1), selection: valid(next, s.selection), editing: null, last: null };
    }
    case "select":
      return { ...s, selection: valid(s.doc, a.ids), editing: s.editing && a.ids.includes(s.editing) ? s.editing : null };
    case "edit":
      return { ...s, editing: a.id && s.doc.nodes[a.id] ? a.id : null, selection: a.id && s.doc.nodes[a.id] ? [a.id] : s.selection, last: null };
    case "replace":
      return { ...s, doc: a.doc, past: [...s.past, s.doc].slice(-HISTORY), future: [], selection: valid(a.doc, s.selection), editing: null, last: null };
  }
}
