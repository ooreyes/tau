## Tau — how to build with this library

Tau is a SPICE-class circuit simulator that wants to read as a **bench
instrument**, not a web app. One rule governs every visual decision:

> **Color is measurement.** Saturated color means exactly two things: a
> measured trace, or a status lamp. Chrome is cool, sharp and restrained.

So: no brand gradients, no tinted card backgrounds, no colored panel headers.
The accent (`--accent`, a precision blue) is for focus, selection and filled
primary buttons only — never a panel wash. A trace hue never appears in chrome.
Status color appears as a lamp, a hairline, or a shallow tint — never as a
full-saturation fill behind a paragraph.

### Setup

Wrap the tree in `TooltipProvider` once at the root. `Tooltip` self-wraps, but
`InstrumentIconButton` — used all over plot and schematic chrome — renders a
bare `TooltipTrigger`/`TooltipContent` pair and needs an ancestor provider.
There is no other app-level provider; state lives in Zustand stores that work
without one.

Theme is an attribute on `<html>`, not a React context:
`data-theme="light"` / `"dark"`, or **no attribute** to follow the OS. Light is
the product default. Never hardcode a hex — every color below re-themes for
free, and a literal will be wrong in one of the two themes.

```jsx
<TooltipProvider>
  <div className="bg-background text-foreground">{/* your screen */}</div>
</TooltipProvider>
```

### The styling idiom — read this before writing a class name

`styles.css` is **compiled** Tailwind v4 output, and there is no Tailwind
compiler at design time. It contains only the ~1100 utilities Tau's own source
uses. A plausible-looking utility that Tau never used **does not exist** and
will silently do nothing — `bg-paper`, `text-ink`, `text-precision`,
`bg-success`, `bg-warning`, `ring-ring` and `text-accent-foreground` are all in
this category despite their tokens being defined.

Two safe moves, in order of preference:

**1. Reuse the utilities that ship.** These are verified present:

| Role | Classes |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-popover`, `bg-secondary`, `bg-accent` |
| Text | `text-foreground`, `text-muted-foreground`, `text-popover-foreground`, `text-primary-foreground`, `text-secondary-foreground`, `text-destructive` |
| Fills | `bg-primary`, `bg-destructive` |
| Edges | `border-border`, `border-border-strong` |
| Radius | `rounded-sm`, `rounded-md`, `rounded-lg` |
| Type | `text-xs`, `font-medium`, `mono-num` (tabular figures — use for every number) |
| Density | `h-7` (28 px, the standard row), `h-8`, `px-2.5`, `gap-1.5` |

**2. For anything else, use the custom properties directly.** They are always
defined, always theme-correct, and are what Tau's own hand-written CSS uses:

```jsx
<div style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)' }} />
```

- Surfaces: `--bg` (canvas — the instrument face, darkest in dark / lightest in
  light), `--panel`, `--panel-2`, `--panel-3`, `--panel-4` (elevated control /
  popover fill)
- Edges: `--border`, `--border-strong`, `--border-subtle`
- Text: `--text`, `--muted`, `--faint`
- Interaction: `--accent`, `--accent-line`, `--overlay-hover`, `--scrim`
- Type: `--font-ui`, `--font-mono`, `--font-display`; metrics `--row-h`,
  `--r-lg`, `--elev-pop`
- **Data only:** `--trace-cyan`, `--trace-green`, `--trace-cream`,
  `--trace-red`, `--trace-purple`, `--trace-amber`
- **Status lamps only:** `--diagnostic-ok`, `--diagnostic-warning`,
  `--diagnostic-error` (each also has `-text`, `-soft`, `-line`, `-glow`)

Settings surfaces have their own composed vocabulary — do not rebuild it with
utilities. Use `SettingsPage` → `SettingsGroup` → `SettingsRow`, plus
`SettingsToggle`, `SegmentedControl`, `Readout` and `SettingsNotice`. Their
`tau-settings-*` and `tau-readout` classes are already styled.

### Where the truth is

- `_ds/<folder>/styles.css` and the `_ds_bundle.css` it imports — the actual
  shipped rules. Read them before inventing a class.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage.
- `components/<group>/<Name>/<Name>.d.ts` — the prop contract.

Groups map to product surfaces: `primitives` (shadcn-derived controls),
`app-chrome`, `plots`, `canvas`, `instrument`, `editors`, `dialogs`,
`inspector`, `results`, `settings`, `schematic`.

### An idiomatic screen

Library components for the controls; token custom properties for your own
layout glue.

```jsx
<TooltipProvider>
  <div style={{ background: 'var(--bg)', padding: 16 }}>
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Select defaultValue="tran">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tran">Transient</SelectItem>
            <SelectItem value="ac">AC sweep</SelectItem>
          </SelectContent>
        </Select>
        <Button>Run</Button>
        <InstrumentIconButton label="Fit to data" icon={Crosshair} />
      </div>

      <Separator />

      <div style={{ display: 'flex', gap: 32 }}>
        <Readout value="2.4815" unit="V" label="V(out)" />
        <Readout value="1.59155" unit="kHz" label="−3 dB" />
      </div>
    </div>
  </div>
</TooltipProvider>
```
