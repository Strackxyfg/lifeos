# Design System & UI/UX Specifications — LifeOS AI

The system is implemented as tokens in [`../app/globals.css`](../app/globals.css) and mapped
in [`../tailwind.config.ts`](../tailwind.config.ts). This doc is the rationale + specs.

## Design principles

1. **Graphite, not black.** The canvas is a near-black graphite (`#0A0A0B`) with panels a
   hair lighter. Depth comes from subtle elevation, never from heavy shadows.
2. **One accent, used sparingly.** A single restrained signal blue. It appears on focus
   rings, the primary CTA, active states, and small live indicators — nowhere else.
3. **Type carries the design.** Geist Sans, tight tracking on headings, an editorial scale.
4. **Massive whitespace.** Sections breathe (`py-24`/`py-32`); content maxes at 1200px.
5. **Hairline borders.** 1px `--border` separators do the structural work cards used to.
6. **Soft motion only.** opacity · translateY · scale. 150–500ms. No bounce, no spin (except a slow, deliberate generation orb).

### Explicitly avoided (per brief)

Purple gradients · generic hero · default Tailwind components · generic dashboards · stock
illustrations · generic cards · rounded-full buttons everywhere · neon/cyberpunk.

## Tokens

| Token | Value (dark) | Use |
|---|---|---|
| `--background` | `240 6% 4%` | Canvas |
| `--surface` / `--surface-2` | `6%` / `9%` | Panels / elevated |
| `--foreground` | `60 6% 94%` | Warm porcelain ink |
| `--muted` / `--muted-foreground` | `44%` / `66%` | Secondary/tertiary ink |
| `--border` / `--border-strong` | `13%` / `20%` | Hairline / hover |
| `--accent` | `222 90% 64%` | The one accent |
| `--success/warning/danger` | green/amber/red | Status only |
| `--radius` | `0.875rem` (14px) | Corners (12–16px range) |
| `--ease-premium` | `cubic-bezier(.22,1,.36,1)` | The house easing |

A `.light` theme is defined for completeness; the product is **dark-first**.

## Typography scale

Geist Sans (UI) + Geist Mono (numerics, keys, code). Fluid `clamp()` sizes:

| Style | Size | Tracking / weight |
|---|---|---|
| `display` | 44–80px | -0.03em / 560 |
| `h1` | 32–52px | -0.025em / 560 |
| `h2` | 24–36px | -0.02em / 540 |
| `lead` | 19px | -0.01em, 1.6 line |
| `eyebrow` | 13px | +0.08em, uppercase |

Numeric/OpenType features enabled (`ss01`, `cv11`, ligatures) for a refined feel.

## Spacing & grid

- **8px base grid** throughout.
- **12-column** mental model; marketing uses a centered `max-w-content` (1200px) container.
- Section rhythm: `py-24` (mobile) → `py-32` (desktop).

## Components (specs)

- **Button** — 5 variants (primary porcelain, accent, secondary hairline, ghost, link) ×
  4 sizes. `active:scale-.985`, 200ms premium ease, accent CTA gains a soft glow on hover.
- **Card** — hairline border, `surface` bg, optional header with divider. Lightweight; hover raises border to `border-strong` and (for interactive) a 0.5px lift + soft shadow.
- **Badge / eyebrow** — hairline pill, optional live dot.
- **Kbd** — mono, bordered, for ⌘K and shortcuts.
- **Switch** — 40×24 track, accent when on, 200ms.
- **Skeleton** — shimmer via masked gradient (`.skeleton`).

## Motion language

Defined in [`../lib/motion.ts`](../lib/motion.ts): `fadeUp`, `fadeIn`, `scaleIn`,
`stagger()`, `reveal`. Scroll reveals use `whileInView` (once, -80px margin). Everything
respects `prefers-reduced-motion` (globally reduced in CSS).

Signature interactions:
- **Hero preview** rises + fades in on load with a subtle aurora bloom behind it.
- **Command menu (⌘K)** scales from 0.98 with a backdrop blur.
- **Generation** — steps tick pending → active (spinner) → done (check), progress bar eases.
- **Onboarding** — direction-aware horizontal slide between questions.

## UI/UX Specifications

### Flows

1. **Marketing → waitlist/signup.** Single primary CTA repeated; ⌘K discoverable.
2. **Onboarding (10 Qs).** One question per screen, keyboard-first: text = Enter to advance;
   single/boolean = click auto-advances; multi = toggle + Continue. Progress bar + `NN/10`.
   Back always available; answers persist to `sessionStorage`.
3. **Generation.** Honest live progress mirroring real `GenerationEvent`s; success state
   with a single "Open your workspace" CTA.
4. **App.** Persistent sidebar (collapses < lg), glass topbar, ⌘K everywhere. Each page:
   header (title + description + optional action) → content. `loading.tsx` skeletons on
   every data route; empty states designed, not blank.

### States (required, all present)

- **Loading** — route-level skeletons (`dashboard/loading.tsx`) + shimmer primitive.
- **Empty** — Team pending invites, Assistant suggestions, generic 404 (`not-found.tsx`).
- **Error** — typed action results surfaced inline (waitlist validation, generate failure).
- **Success** — waitlist confirmation, generation complete, billing "current plan."

### Accessibility

- WCAG AA contrast on graphite verified for text tokens.
- Full keyboard operability (wizard, ⌘K arrow/enter/esc, switches as `role="switch"`).
- Visible `:focus-visible` ring (accent) with offset.
- `prefers-reduced-motion` collapses animation durations to ~0.

### Responsive

Mobile-first. Sidebar → hidden < lg (⌘K + topbar remain). Grids collapse to single column;
the workspace preview swaps its sidebar for mobile tabs. No horizontal body scroll.
