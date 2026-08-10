# Min-window DoD — 900×600 proof (re-proven 2026-08-10)

**Pipeline:** `scripts/min-window-dod.sh` → `scripts/min-window-dod.mjs`  
**Viewport:** tauri.conf.json `minWidth`×`minHeight` = **900×600**  
**Themes:** light + dark  
**States:** empty · schematic · schematic-panels · simulator · dialog · command  

## Result

`MIN-WINDOW: 900x600 fail=0/12` — all PASS.

The Settings measurement targets the current shared Sheet surface
(`[data-slot="sheet-content"].tau-settings-route`) and the gate fails if that
surface is absent. Both themes measured exactly 900×600, fully inside the
viewport; the former stale `.settings-panel` selector could silently record
`dialogGeom: null` and is retired.

The capture emulates the OS reduced-motion preference. Tau's JS-driven current
overlay therefore renders its static direction markers without scheduling the
animation loop, proving that accessibility path and keeping simulator images
independent of the requestAnimationFrame phase at capture time.

| State | Light | Dark |
|-------|-------|------|
| empty | PASS | PASS |
| schematic | PASS | PASS |
| schematic-panels | PASS | PASS |
| simulator | PASS | PASS |
| dialog (Settings) | PASS — fits viewport, `overflow-y: auto` | PASS |
| command | PASS | PASS |

The two schematic captures are stateful: `schematic` closes the Components
rail so the entire imported circuit is visible; `schematic-panels` then opens
it and asserts the rail is present. This prevents a fixture-selected part from
silently reversing the toggle and leaving the component-palette proof empty.

## Fixes in this unit

1. **Settings sheet** (`ui/sheet.tsx`): `max-h-[calc(100vh-60px)]` + `overflow-y-auto` so Appearance / Circuit assistant / Workspace rows stay reachable (was ~669px tall with no scroll → Hugging Face / Import / Clear unreachable).
2. **Editor toolbar** (`App.css`): `overflow-x: auto` on `.editor-toolbar` + `overflow-x: hidden` on `.editor-shell` so Run/Stop stay reachable when Explorer+Library squeeze the schematic column to ~358px.

## Honest scope

- **AGENTS.md min-window box:** checked with this proof.
- **AGENTS.md §10 design-system box:** **CHECKED 2026-08-05** via `scripts/design-system-dod.sh` (not this min-window script).
- **SHIPPABLE?** **NO**
