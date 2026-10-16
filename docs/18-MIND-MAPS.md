# Mind maps

Ideas as trees, each map the person's own: `/brain/maps` (the gallery) and
`/brain/maps/<id>` (the editor, full screen). Notes, links, images, emojis and
colours on ideas; eight themes, three layouts; import from XMind, FreeMind,
OPML, Markdown and Mermaid; export to PNG, SVG, PDF and the same formats.

> **Status.** Engine, formats, store and editor are tested (unit tests in
> `tests/maps-*.test.ts`), and the editor was exercised in the browser on the
> local demo, desktop and phone (touch: tap, double-tap, hold to move, pinch).
> Migration 016 is validated on Postgres (PGlite: 22 checks — idempotent,
> owner-only rows, shape checks, revision saves, per-person image folders).
> It still has to be **applied to the Supabase project** (after 013–015).

---

## 1. Apply migration 016

Run `supabase/migrations/016_mind_maps.sql` in the SQL editor. It is
idempotent and depends only on Supabase Auth and Storage. It adds:

| Object | What |
|---|---|
| `lifeos_mind_maps` | one row per map: `doc` (the tree and its style, JSON), `title` (the central idea), `preview` (a small SVG for the gallery), `node_count`, `revision` |
| bucket `lifeos-map-images` | private, 5 MB per file, WebP / PNG / JPEG / GIF only — never SVG |

Row-level security: a row is its owner's (`user_key = auth.uid()`); an image
is in its owner's folder (`<user_key>/<file>`). Until the migration runs, the
maps tab says so and nothing else changes. Without Supabase, maps live in
`.data/maps.json` and `.data/map-images/<hash>/` (same contract, same tests).

## 2. The document

`lib/maps/model.ts` — a flat record of nodes (`children: id[]`), immutable
updates that share untouched nodes. `parseDoc` is the one door in: every
document read from the database, a file, the clipboard or a draft goes
through it.

| Limit | Value |
|---|---|
| ideas per map | 3 000 |
| depth | 48 |
| text / note | 1 000 / 20 000 characters |
| link | `http(s)://` or `mailto:` only (a bare domain becomes `https://`) |
| emoji | one grapheme (keycaps included) |
| image | a file name LifeOS generated (`<uuid>.<webp|png|jpg|gif>`) |
| stored map | 4 MB of JSON (the database checks it too) |

## 3. Layout and drawing

- `layout.ts` — band layout: each subtree takes a band as tall as its
  children's, so branches never overlap whatever the node sizes (property
  test: random trees × three layouts). `map` splits the root's branches
  between the two sides by weight (a branch can be pinned to a side), `right`
  is a logic chart, `down` an org chart.
- `theme.ts` — eight themes; text on a coloured shape takes whichever ink
  reads better (WCAG ≥ 4.5, tested for every theme and palette colour).
- `measure.ts` — text measured with the page's real font (canvas), wrapped
  grapheme-safe; tests use an approximation.
- One geometry, three renderers: the editor's SVG (`components/maps/map-canvas.tsx`),
  the SVG writer (`svg.ts`: exports and gallery previews) and the canvas
  painter (`paint.ts`: PNG, PDF). They draw the same picture.

## 4. The editor

- Moving and zooming change one transform: nothing is re-rendered; an idea is
  redrawn only when it changed.
- History (`history.ts`): 200 steps; typing in one idea is one step; changes
  are computed from the document as it is when they land; an idea added and
  left empty is taken back without leaving a redo step.
- Saving: 800 ms after the last change; each save names the revision it
  started from. If the map was saved elsewhere since, nothing is overwritten
  and the person chooses (keep mine / load the other). Offline: retried with
  backoff, and the map is kept on the device (localStorage) until LifeOS has
  it; reopening offers to restore it. Closing with unsaved changes warns.
- Keyboard: Tab (child), Enter / Shift+Enter (after / before), F2 or typing
  (edit), Delete, Space (fold), arrows (tree-aware, then spatial), Alt+arrows
  (reorder), Ctrl+Z/Y, Ctrl+C/X/V (indented text any app reads; pasting a
  list adds it; pasting an image puts it on the idea), Ctrl+D, Ctrl+F,
  Ctrl+0, Ctrl+= / −. `?` lists them.
- Touch: tap, double-tap to edit, hold to move, pinch to zoom. The edit field
  is set at 16 px and scaled to the idea's size, so phones never zoom the page.
- Screen readers: the map is an ARIA tree; the **outline view** edits the same
  document as a list.

## 5. Formats (`lib/maps/formats/`)

| Format | Import | Export | Keeps |
|---|---|---|---|
| LifeOS `.lifeosmap.json` | ✓ | ✓ | everything, images inside |
| XMind (8 and 2020+) | ✓ | ✓ | tree, notes, links, images, markers → emojis, folds |
| FreeMind / Freeplane `.mm` | ✓ | ✓ | tree, notes, links, icons → emojis, sides, folds, main branches' colours |
| OPML | ✓ | ✓ | tree, notes, links |
| Markdown | ✓ | ✓ | headings and nested lists, notes as quotes; task boxes read as ⬜ / ✅ |
| Mermaid `mindmap` | ✓ | ✓ | tree |
| indented text | paste | copy | tree, emojis |
| PNG (1–4×, transparent or not), SVG (fonts and images embedded), PDF | — | ✓ | the picture |

Files are read in the browser. The XML reader expands no entity and ignores
DOCTYPEs; the ZIP reader caps entries and inflated sizes (no zip bomb).

## 6. Images

Scaled down in the browser (2 048 px, WebP), then checked on the server from
their bytes (`image.ts`): PNG, JPEG, GIF, WebP; an SVG is refused whatever its
name. Served by `/api/maps/images/<file>` to their owner only, with
`Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`. Images no
map uses are deleted with a map, never within a day of their upload (an
unsaved edit or an undo may still need them).

## 7. AI suggestions

`/api/maps/suggest` (`lib/maps/suggest.ts`): signed in only, 60 per hour per
person, model task `maps`. The model sees the path from the central idea to
the selected one, its sub-ideas and its note — nothing else. Answers are
cleaned (no numbering, no duplicates, six at most) and appear **dashed, marked
as the AI's**, until kept or set aside.

## 8. Elsewhere in LifeOS

- From a note of the brain: the note in the middle, its connections grouped by
  meaning, one more step folded (`from-note.ts`, no model). Also from a note's
  detail ("Open as a mind map").
- The complete export (JSON and ZIP) includes every map; the ZIP adds each one
  as a `.lifeosmap.json` with its images, ready to import again.
- Erasing one's data erases maps and their images.
- Command menu: "New map", "Mind maps"; shortcut **G M**.
