# Min-window DoD — 900×600 proof (2026-08-05)

**Pipeline:** `scripts/min-window-dod.sh` → `scripts/min-window-dod.mjs`  
**Viewport:** tauri.conf.json `minWidth`×`minHeight` = **900×600**  
**Themes:** light + dark  
**States:** empty · schematic · schematic-panels · simulator · dialog · command  

## Result

`MIN-WINDOW: 900x600 fail=0/12` — all PASS.

| State | Light | Dark |
|-------|-------|------|
| empty | PASS | PASS |
| schematic | PASS | PASS |
| schematic-panels | PASS | PASS |
| simulator | PASS | PASS |
| dialog (Settings) | PASS — fits viewport, `overflow-y: auto` | PASS |
| command | PASS | PASS |

## Fixes in this unit

1. **Settings sheet** (`ui/sheet.tsx`): `max-h-[calc(100vh-60px)]` + `overflow-y-auto` so Appearance / Circuit assistant / Workspace rows stay reachable (was ~669px tall with no scroll → Hugging Face / Import / Clear unreachable).
2. **Editor toolbar** (`App.css`): `overflow-x: auto` on `.editor-toolbar` + `overflow-x: hidden` on `.editor-shell` so Run/Stop stay reachable when Explorer+Library squeeze the schematic column to ~358px.

## Honest scope

- **AGENTS.md min-window box:** checked with this proof.
- **AGENTS.md §10 design-system box:** stays **unchecked** (native selects / Resizable / drift proof remain).
- **SHIPPABLE?** **NO**
