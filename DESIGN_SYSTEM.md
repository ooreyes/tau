# Tau Design System

Normative. If a change conflicts with this document, the change is wrong unless this
document is updated in the same commit.

---

## 0. The one rule

**Color is measurement.**

Saturated color in Tau means exactly two things: a **measured trace**, or a **status lamp**.
Chrome is cool, sharp, and restrained - Anduril Light paper with a precision-blue
interaction accent (not purple SaaS, not cream-terracotta, not flat dead gray).

This is the rule that makes Tau read as a bench instrument instead of a consumer app, and it
is the first thing to check in review. A washed brand gradient, a colored panel header, or a
tinted card background all break it: they spend the user's attention budget on chrome, and
they compete with the only thing on screen that is actually data. The precision-blue accent
is for focus, selection, and filled primary controls only - never a panel wash.

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
| `--bg` | `#000000` | `#EDF1F6` | Instrument face / app ground |
| `--panel` | `#1c1c1e` | `#E2E8F0` | Panel fill |
| `--panel-2` | `#2c2c2e` | `#D4DCE6` | Recessed / secondary fill |
| `--panel-3` | `#161617` | `#E8EDF3` | Sidebar, toolbar underlay |
| `--panel-4` | `#3a3a3c` | `#FFFFFF` | Elevated control, popover |
| `--canvas-bg` | `#000000` | `#EDF1F6` | Schematic ground |
| `--canvas-surface` | `#0a0a0a` | `#F7F9FC` | Schematic sheet |
| `--scope-surface` | `#0c0c0e` | `#F0F4F8` | Plot face |

Light neutrals carry a cool blue-gray undertone (Apple/Anduril paper), not a warm cream
bias. Pure `#808080` greys still read as unconsidered next to the precision-blue accent.

#### Anduril Light palette pop (2026-08-04) — before → after

Token-value delta only (both `@media (prefers-color-scheme: light)` and
`:root[data-theme="light"]` in `apps/desktop/src/App.css`). Design-shot not
re-run this unit; Design QA should capture light empty/schematic/dialog at
min + 1440.

| Token | Before | After |
|---|---|---|
| `--bg` / `--canvas-bg` | `#F5F6F8` | `#EDF1F6` |
| `--panel` | `#EBEEF2` | `#E2E8F0` |
| `--panel-2` | `#E0E4EA` | `#D4DCE6` |
| `--panel-3` | `#F0F2F5` | `#E8EDF3` |
| `--canvas-surface` | `#FAFBFC` | `#F7F9FC` |
| `--scope-surface` | `#F7F8FA` | `#F0F4F8` |
| `--text` / `--canvas-label` | `#111418` | `#0B1017` |
| `--muted` | `#5F6B7C` | `#4E5C6E` (~6.0:1 on paper) |
| `--faint` | `#8F99A8` | `#7B8798` |
| `--accent` | `#0A66C2` | `#0068D6` (~5.3:1 white-on-blue) |
| `--accent-hover` | `#0856A5` | `#0057B8` |
| `--diagnostic-warning` (-text) | `#b25000` | `#A34A00` |
| `--diagnostic-warning-soft` | `0.06` ochre | `0.05` ochre (stays quiet; not danger-red) |

Tailwind aliases in `apps/desktop/src/styles/tokens.css` (var() → App.css cascade):
`--color-paper` → `--bg`, `--color-ink` → `--text`, `--color-precision` → `--accent`.

### 1.2 Separators and fills

| Token | Dark | Light |
|---|---|---|
| `--border` | `rgba(84, 84, 88, 0.65)` | `rgba(11, 16, 23, 0.13)` |
| `--border-strong` | `rgba(142, 142, 147, 0.45)` | `rgba(11, 16, 23, 0.24)` |
| `--border-subtle` | `rgba(84, 84, 88, 0.36)` | `rgba(11, 16, 23, 0.09)` |
| `--overlay-hover` | `rgba(120, 120, 128, 0.24)` | `rgba(11, 16, 23, 0.06)` |
| `--overlay-hover-faint` | `rgba(120, 120, 128, 0.14)` | `rgba(11, 16, 23, 0.035)` |
| `--scrim` | `rgba(0, 0, 0, 0.36)` | `rgba(8, 16, 32, 0.24)` |
| `--scrim-strong` | `rgba(0, 0, 0, 0.55)` | `rgba(8, 16, 32, 0.40)` |

### 1.3 Ink

| Token | Dark | Light |
|---|---|---|
| `--text` | `#f5f5f7` | `#0B1017` |
| `--muted` | `rgba(235, 235, 245, 0.60)` | `#4E5C6E` |
| `--faint` | `rgba(235, 235, 245, 0.30)` | `#7B8798` |

Light `--muted` is a solid cool slate, not a translucent mix: body text must clear
WCAG AA 4.5:1 on paper (~6.0:1 measured on `#EDF1F6`).

### 1.4 Accent - precision blue (light) / warm ice (dark)

Light: Apple×Palantir precision blue for focus, selection, and filled primary controls.
Dark: near-neutral warm ice so chrome stays quiet on the black instrument face. Neither may
compete with a trace hue.

| Token | Dark | Light |
|---|---|---|
| `--accent` | `#d6d3ca` | `#0068D6` |
| `--accent-hover` | `#ebe8df` | `#0057B8` |
| `--accent-ink` | `#121214` | `#FFFFFF` |
| `--accent-soft` | `rgba(214, 211, 202, 0.10)` | `rgba(0, 104, 214, 0.09)` |
| `--accent-line` | `rgba(214, 211, 202, 0.38)` | `rgba(0, 104, 214, 0.40)` |

Light filled primary is white ink on `#0068D6` (~5.3:1). Dark filled primary remains cream
ink on warm ice - the inverse weight relationship of the dark instrument metaphor.

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
(Re-verified 2026-08-06 by running both commands above.)

> **Audit note — 2026-08-06: a rotation drift was found here and is now fixed.**
> The **native ngspice path** — the engine that actually runs on the desktop
> build — had shipped a different order in `apps/desktop/src/engine/nativeSpice.ts`:
> cyan, green, cream, red, purple, amber. That put olive directly after green.
> Measured, not assumed: that order fails the validator twice — normal-vision
> `#9A8C00↔#0CA176` ΔE **13.7** against a floor of 15, and CVD
> `#D86108↔#9A8C00` ΔE **0.8** under deuteranopia. The preview solver's list in
> `simulation/linearTransient.ts` was correct throughout, and
> `styles/palette.test.ts` only parsed that one file, so the native list was
> unguarded and drifted silently.
>
> Both lists now use the documented order, and `styles/palette.test.ts`
> enumerates every renderer's `TRACE_COLORS`, validates each in its own order,
> and asserts the lists are identical to one another — verified to fail on the
> old order before the fix landed. **Adding a new renderer means adding it to
> `ROTATION_SOURCES` in that test**; a rotation that exists but is not listed is
> precisely the gap that allowed this. As before: fix the code, never edit this
> table to match.

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
| `--diagnostic-warning` | `#ff9f0a` | `#A34A00` |
| `--diagnostic-error` | `#ff453a` | `#d70015` |

Each has `-soft` (≤11% tint), `-line` (≈0.42 hairline) and `-glow` variants. Diagnostics are
deliberately brighter than the general semantic pair so status is glanceable, and are
constrained to lamps, hairlines and shallow glass tint. Light warning chrome stays **quiet
ochre** (`-soft` ≈0.05) — empty optional keys must never paint danger-red.

#### Emission — the one thing on the canvas that is a light source

| Token | Dark | Light |
|---|---|---|
| `--led-glow-core` | `#ffd9a0` | `#E39A20` |
| `--led-glow-blend` | `screen` | `multiply` |

A lit LED (`components/LedGlowLayer.tsx`) is the sole exception to "no glow, gradient fill or
drop shadow" above, because there the glow **is** the measurement: it is drawn only from a
solved forward current, and never at all without one.

Three rules make it read as light rather than as a decal, and all three are asserted in
`LedGlowLayer.test.tsx`:

1. **No stroke.** Light has no outline. The disc this replaced had a 1px `--signal` rim and
   that alone was enough to make it look like a sticker on the symbol.
2. **Alpha reaches zero at the rim.** The fill is a radial gradient — hot `--led-glow-core`
   at the die, `--signal` through the bloom, fully transparent at the edge — so there is no
   boundary to see. A flat fill is the defect, not a simplification of it.
3. **The halo stays subordinate to the part.** The perceptible disc (down to 5% alpha) stays
   within ~1.2× the LED's own 30-unit body. The reference plates keep luminous elements from
   swallowing the mark they belong to; so does this.

`--led-glow-blend` is why this survives both themes. On the black instrument face emission is
**additive** (`screen`). On paper it cannot be — adding light to white does nothing — so a lamp
reads as **saturation** instead (`multiply`), and the core token is correspondingly a
saturated amber rather than a near-white one. A glow tuned only on black is the case most
likely to be wrong; check the light theme.

### 1.7 Grid

| Token | Dark | Light |
|---|---|---|
| `--grid-dot` | `rgba(235, 235, 245, 0.08)` | `rgba(11, 16, 23, 0.10)` |
| `--grid-dot-major` | `rgba(235, 235, 245, 0.13)` | `rgba(11, 16, 23, 0.16)` |

The grid must stay clearly below wires and components in contrast. If the grid competes with
the circuit, the grid is wrong.

### 1.8 Floating chrome

The canvas is the substrate. Chrome that sits **on** it, rather than docked beside it, is made
of one material.

| Token | Dark | Light |
|---|---|---|
| `--chrome-veil` | `rgba(12, 12, 14, 0.72)` | `rgba(247, 249, 252, 0.78)` |
| `--chrome-veil-strong` | `rgba(12, 12, 14, 0.88)` | `rgba(247, 249, 252, 0.92)` |
| `--chrome-blur` | `12px` | `12px` |
| `--chrome-blur-saturate` | `160%` | `160%` |
| `--elev-float` | `0 6px 20px rgba(0,0,0,0.38), 0 0 0 0.5px rgba(255,255,255,0.10)` | `0 6px 20px rgba(8,16,32,0.12), 0 0 0 0.5px rgba(11,16,23,0.10)` |

**Veil, not panel.** The alpha is chosen so the grid stays faintly visible through it. That
translucency is the entire signal that a surface is *above* the drawing rather than another
panel next to it. An opaque `--panel-3` rail is a docked column wearing a float costume.

**Two tiers of elevation, and the second one is an absence.**

- **Persistent** chrome (nav rail, transport cluster, status readout) gets veil and **no
  shadow**. There is deliberately no token for a persistent-chrome shadow; not having one is
  how the rule is enforced.
- **Summoned** surfaces (parts palette, inspector, sheets) get `--elev-float`. A shadow's job
  is to say "this came from somewhere and will go back". Six shadowed floating panels is a
  generic dashboard, which is the failure this tier exists to prevent.
- **Modal** surfaces keep `--elev-pop` and a `--scrim`.

`--chrome-blur` and `--chrome-blur-saturate` are geometry, not colour, so they are defined once
in `:root` and not redefined per theme. Every veiled surface uses both; a surface that picks its
own blur has stopped being the same material. The one documented exception is the run-overlay
scrim, which uses a 2px haze to dim content behind it rather than to be a surface.

### 1.9 Stacking

| Token | Value | Stratum |
|---|---|---|
| `--z-canvas` | 0 | the substrate |
| `--z-chrome` | 10 | rail, transport, status readout |
| `--z-drawer` | 20 | results drawer |
| `--z-summoned` | 30 | palette, explorer, assistant sheets |
| `--z-inspector` | 40 | must clear a sheet it may overlap |
| `--z-modal` | 50 | scrim, dialogs, command palette |
| `--z-toast` | 60 | |

Stated once, in order. Two strata chosen independently is how a drawer ends up over a modal.

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

   **Audit — 2026-08-06.** `App.css` itself is clean: every hex/rgba literal below the
   three `:root` blocks (dark, `@media (prefers-color-scheme: light)`,
   `:root[data-theme]`) is gone. The rule is *not* currently met outside `App.css` —
   seven raw values remain and are known violations, not sanctioned exceptions:
   `lib/assistantCircuitPlan.ts:1259-1269` (five hexes in the SVG plan-preview
   strokes/fills), `components/SimulationPanel.tsx:697` (`"#000"` probe sentinel), and
   `lib/cssColor.ts:43` (parser fallback). One `color-mix(in srgb, white 10%, …)`
   keyword also survives at `App.css:4593`.
2. **Both themes, every change.** A component styled only for dark is unfinished.
3. **Screenshot every visual change.** `node scripts/design-shot.mjs <label>` captures eight
   app states (empty, schematic, inspector, model, subcircuit, simulator, dialog, command)
   at three viewports (1440×900, 1280×720, and the declared minimum)
   **in both themes** into `screenshots/<label>/`, named
   `<state>-<theme>-<width>x<height>.png`. A design commit that does not visibly differ
   from the previous shot did not do anything. Look at the light shots too: Playwright's
   default colour scheme is light, so before this was explicit the pipeline had silently
   stopped covering dark the moment light tokens landed.
4. **Tokens are defined once**, in `App.css` `:root` and its light counterpart. Component CSS
   consumes them and never redefines them.
