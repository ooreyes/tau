# Tau Design System

Normative. If a change conflicts with this document, the change is wrong unless this
document is updated in the same commit.

---

## 0. The one rule

**Color is measurement.**

Saturated color in Tau means exactly two things: a **measured trace**, or a **status lamp**.
Everything else - every panel, toolbar, button, tab, input, label, border - is neutral
graphite and warm ice.

This is the rule that makes Tau read as a bench instrument instead of a consumer app, and it
is the first thing to check in review. A blue "primary" button, a colored panel header, or a
tinted card background all break it: they spend the user's attention budget on chrome, and
they compete with the only thing on screen that is actually data.

Corollaries:

- The canvas is the darkest (dark theme) or lightest (light theme) surface in the app. It is
  the instrument face; chrome sits on top of it, never the reverse.
- A control may use the accent for *focus* and *selection*. It may not use a trace hue.
- A trace hue may never appear in chrome. If a legend swatch needs the trace color, that
  swatch **is** data.
- Status color appears as a lamp, a hairline, a small text run, or a shallow tint. Never as
  a full-saturation fill behind a paragraph.

---

## 1. Themes

Both themes are first-class. **Light is the product default** (first launch and
corrupt-storage fallback) - paper chrome that reads as a paid engineering tool.
Dark remains a first-class explicit choice and the System mode still follows the
OS via `prefers-color-scheme`. The instrument metaphor was designed around dark;
light is derived for the large share of LTspice users who work on white and print
schematics.

Light is **derived, not inverted**. A naive inversion produces glowing pastel traces on
paper, which is the exact failure mode that makes engineering tools look amateur. Light-theme
traces are darkened and slightly saturated to hold contrast against a near-white face, while
keeping their hue identity so a user switching themes still recognizes "the cyan one".

Every color below is a token in `apps/desktop/src/App.css`. Nothing in the app may reference
a raw color value - see §7.

### 1.1 Surfaces

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `#000000` | `#fbfbfa` | Instrument face / app ground |
| `--panel` | `#1c1c1e` | `#f2f1ee` | Panel fill |
| `--panel-2` | `#2c2c2e` | `#e8e7e3` | Recessed / secondary fill |
| `--panel-3` | `#161617` | `#f7f6f4` | Sidebar, toolbar underlay |
| `--panel-4` | `#3a3a3c` | `#ffffff` | Elevated control, popover |
| `--canvas-bg` | `#000000` | `#fbfbfa` | Schematic ground |
| `--canvas-surface` | `#0a0a0a` | `#f6f5f2` | Schematic sheet |
| `--scope-surface` | `#0c0c0e` | `#f7f7f5` | Plot face |

The light neutrals carry a deliberate warm bias (toward the ice accent) rather than a pure
grey. Pure `#808080`-family greys read as unconsidered next to the warm accent family.

### 1.2 Separators and fills

| Token | Dark | Light |
|---|---|---|
| `--border` | `rgba(84, 84, 88, 0.65)` | `rgba(60, 60, 67, 0.22)` |
| `--border-strong` | `rgba(142, 142, 147, 0.45)` | `rgba(60, 60, 67, 0.36)` |
| `--border-subtle` | `rgba(84, 84, 88, 0.36)` | `rgba(60, 60, 67, 0.13)` |
| `--overlay-hover` | `rgba(120, 120, 128, 0.24)` | `rgba(60, 60, 67, 0.10)` |
| `--overlay-hover-faint` | `rgba(120, 120, 128, 0.14)` | `rgba(60, 60, 67, 0.05)` |
| `--scrim` | `rgba(0, 0, 0, 0.36)` | `rgba(0, 0, 0, 0.20)` |
| `--scrim-strong` | `rgba(0, 0, 0, 0.55)` | `rgba(0, 0, 0, 0.32)` |

### 1.3 Ink

| Token | Dark | Light |
|---|---|---|
| `--text` | `#f5f5f7` | `#1c1c1e` |
| `--muted` | `rgba(235, 235, 245, 0.60)` | `rgba(60, 60, 67, 0.62)` |
| `--faint` | `rgba(235, 235, 245, 0.30)` | `rgba(60, 60, 67, 0.34)` |

### 1.4 Accent - warm ice / graphite

Deliberately near-neutral. It is the *interaction* color, not a brand color, and it must never
compete with a trace.

| Token | Dark | Light |
|---|---|---|
| `--accent` | `#d6d3ca` | `#3a362f` |
| `--accent-hover` | `#ebe8df` | `#4c473e` |
| `--accent-ink` | `#121214` | `#faf9f6` |
| `--accent-soft` | `rgba(214, 211, 202, 0.10)` | `rgba(58, 54, 47, 0.07)` |
| `--accent-line` | `rgba(214, 211, 202, 0.38)` | `rgba(58, 54, 47, 0.32)` |

The light accent is the same warm family rotated to the dark end of the ramp, not a different
hue. A filled primary control is a dark warm graphite face with cream ink - the exact inverse
relationship of the dark theme, so the control keeps its weight in the hierarchy.

### 1.5 Traces - the instrument palette

**Okabe-Ito**, the colorblind-safe qualitative set from Okabe & Ito's *Color
Universal Design*, snapped into each surface's OKLCH lightness band. This
replaced a hand-tuned set that failed on measurement, not taste: sage green and
steel cyan sat at **deltaE 11.6 for normal vision** against a floor of 15, so
V(in) and V(out) on one scope were hard to separate for *everyone*, before
considering the ~8% of men with red-green colour vision deficiency.

Rotation order, and it is load-bearing:

| # | Token | Dark | Light | Name |
|---|---|---|---|---|
| 1 | `--trace-green` | `#0CA176` | `#008B62` | green |
| 2 | `--trace-red` | `#D86108` | `#C04A00` | vermillion |
| 3 | `--trace-cyan` | `#3193C6` | `#0E7EB0` | sky |
| 4 | `--trace-cream` | `#9A8C00` | `#857700` | olive |
| 5 | `--trace-purple` | `#BC6A98` | `#A55583` | purple |
| 6 | `--trace-amber` | `#BD7900` | `#A76300` | orange |

The token names are historical; the comment beside each value names the real
hue. **The order is part of the result.** These hues only clear the adjacent
pair checks in this sequence - olive next to green fails the normal-vision
floor, and orange next to olive fails CVD separation outright at deltaE 0.6.

**Do not change a value or the order by eye.** Re-run the validator:

```
node scripts/validate-palette.mjs "#0CA176,#D86108,#3193C6,#9A8C00,#BC6A98,#BD7900" --mode dark
node scripts/validate-palette.mjs "#008B62,#C04A00,#0E7EB0,#857700,#A55583,#A76300" --mode light
```

Both currently report ALL CHECKS PASS: lightness band, chroma floor, adjacent
CVD separation, normal-vision floor, and contrast against the surface.

Traces are drawn at 1.5px. No glow, gradient fill, or drop shadow: decoration
misrepresents the precision of the data. `--signal` (amber) is the running
lamp and is **status, not a series** - never assign it to a trace.

### 1.6 Status

`--signal` (amber) is the running/armed lamp - an instrument indicator, not a warning siren.

| Token | Dark | Light |
|---|---|---|
| `--danger` | `#e6564b` | `#c02718` |
| `--success` | `#4fae6b` | `#248a3d` |
| `--diagnostic-ok` | `#30d158` | `#248a3d` |
| `--diagnostic-warning` | `#ff9f0a` | `#b25000` |
| `--diagnostic-error` | `#ff453a` | `#d70015` |

Each has `-soft` (≤11% tint), `-line` (≈0.42 hairline) and `-glow` variants. Diagnostics are
deliberately brighter than the general semantic pair so status is glanceable, and are
constrained to lamps, hairlines and shallow glass tint.

### 1.7 Grid

| Token | Dark | Light |
|---|---|---|
| `--grid-dot` | `rgba(235, 235, 245, 0.08)` | `rgba(60, 60, 67, 0.12)` |
| `--grid-dot-major` | `rgba(235, 235, 245, 0.13)` | `rgba(60, 60, 67, 0.20)` |

The grid must stay clearly below wires and components in contrast. If the grid competes with
the circuit, the grid is wrong.

---

## 2. Typography

Native Apple stack. No webfont, no download, no layout shift.

```
--font-ui       -apple-system, BlinkMacSystemFont, "SF Pro Text", …
--font-display  -apple-system, BlinkMacSystemFont, "SF Pro Display", …
--font-mono     "SF Mono", ui-monospace, Menlo, Monaco, …
```

### 2.1 Scale

Instrument-dense on purpose. A circuit simulator shows a great deal of state at once; this is
closer to Xcode's inspector than to a marketing page.

| Token | Size | Used for |
|---|---|---|
| `--fs-micro` | 9px | Canvas net labels, pin annotations |
| `--fs-caption` | 10px | Uppercase section labels, keycaps, units |
| `--fs-body` | 11px | Body copy, list rows |
| `--fs-label` | 12px | Control labels, tabs, buttons |
| `--fs-title` | 13px | Panel titles |
| `--fs-heading` | 15px | Dialog headings |
| `--fs-display` | 17px | Empty-state and onboarding headline |

Do not introduce a size outside this scale.

### 2.2 Roles

- **Every number a user reads as data is `--font-mono` with `font-variant-numeric:
  tabular-nums`.** Measurements, component values, cursor readouts, sample counts, times,
  coordinates. Digits must not shift width as a value updates - a jittering readout is the
  single most "not a real instrument" tell.
- Uppercase micro-labels take `--tracking-wide` (0.06em). Uppercase without added tracking
  reads as cramped at 10px.
- Weight tiers: 400 body, 510-550 secondary UI, 600 emphasis/controls. Do not use 700+.
- Headings get `text-wrap: balance`.

---

## 3. Space, radius, motion

Spacing is a 4px base: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 ·
`--sp-6` 24 · `--sp-8` 32. Lay out sibling groups with flex/grid `gap`, not per-element
margins.

Radii: `--r-sm` 6 (inputs, keycaps, small controls) · `--r-md` 8 (buttons, cards) · `--r-lg`
and `--r-xl` for dialogs and sheets. Do not round everything to the same value; radius is
part of the hierarchy.

Motion: `--motion-fast` 120ms for state changes and popovers, `--motion-med` 220ms for
travelling surfaces (sheets, drawers), both on `--spring`
`cubic-bezier(0.25, 0.1, 0.25, 1)`. Animate `opacity` and `transform` only. Nothing in the
app animates longer than 220ms - an instrument responds, it does not perform.

All motion must be wrapped for `prefers-reduced-motion: reduce`.

---

## 4. Component rules

**Buttons.** One filled accent control per surface at most - usually Run. Everything else is
`outline` or `ghost`. If two filled controls are visible at once, one of them is wrong.

**Run.** The primary transport control. Quiet at rest; the amber `--signal` lamp carries the
running state, not a color change of the whole button.

**Panels.** Fill `--panel`, hairline `--border`, `--r-md`. No drop shadow between docked
panels - use the hairline. Shadow is reserved for surfaces that genuinely float (popover,
dialog, sheet, toast).

**Tables.** Header row is `--muted` uppercase `--fs-caption` on the panel fill, separated by a
hairline. A header row must not carry a filled background block - it reads as a selected row.
Numeric columns are mono, tabular, right-aligned.

**Errors and diagnostics.** A hairline plus a lamp plus text. Never a saturated banner fill
behind a paragraph.

**Focus.** Always visible: 2px `--accent` ring at 50% via `focus-visible`. Never remove the
outline without replacing it.

**Empty states.** Name the single next action and provide a button for it. If the copy
mentions three ways in, there are three buttons or the copy is wrong.

---

## 5. Canvas and plots

- Component strokes `--comp`, reference designators `--comp-ref`.
- Labels never overlap. Net labels, reference designators and value labels share one
  collision-avoidance pass - a label placed without seeing the others is a bug, not a
  near-miss.
- Plots: face `--scope-surface`, grid `--scope-grid`, axes and tick text `--muted`. Axis
  labels are uppercase `--fs-caption` with `--tracking-wide`.
- A plot always states its units.

---

## 6. Voice

- Say what happened and what to do. `Save blocked: Tau cannot yet preserve symbol label
  placement.` is right. `An error occurred.` is not.
- Name the part and the consequence: `M1: model "IRF540" was not found. Tau would simulate it
  as a generic NMOS (Level=1), which will not match the real device.`
- No exclamation marks. No apologies. No em-dashes in shipped strings.
- Never name the implementation to the user. The user has a *schematic*, not an "AscDocument";
  they attach a *model library*, not a "subckt provider".
- Buttons are verbs and the result matches: `Publish` then `Published`.

---

## 7. Enforcement

1. **No hardcoded colors.** Every color routes through a token. `styles/tokens.css` wipes
   Tailwind's stock palette (`--color-*: initial`) so `bg-red-500` is a build error rather
   than a review comment. The 11 raw values that used to sit outside `:root` in `App.css`
   are now tokenized (`--control-edge`, `--thumb-shadow`, `--thumb-shadow-active`,
   `--fill-track`, `--pill-shadow`).

   **Scan for color *keywords*, not just hex and rgba.** A hex/rgba grep misses
   `color-mix(in srgb, var(--success) 32%, white)`, which is how the Run button's label
   went near-invisible in light mode: mixing toward `white` is only correct on a dark
   fill. That case now routes through `--status-ink-mix`, which flips to `black` on light.
2. **Both themes, every change.** A component styled only for dark is unfinished.
3. **Screenshot every visual change.** `node scripts/design-shot.mjs <label>` captures six
   app states at three viewports **in both themes** into `screenshots/<label>/`, named
   `<state>-<theme>-<width>x<height>.png`. A design commit that does not visibly differ
   from the previous shot did not do anything. Look at the light shots too: Playwright's
   default colour scheme is light, so before this was explicit the pipeline had silently
   stopped covering dark the moment light tokens landed.
4. **Tokens are defined once**, in `App.css` `:root` and its light counterpart. Component CSS
   consumes them and never redefines them.
