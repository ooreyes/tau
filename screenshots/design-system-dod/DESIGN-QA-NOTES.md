# Design-system DoD QA notes

**Captured:** 2026-08-10T04:45:03.519Z
**Viewport:** 1440×900
**Themes:** light + dark
**States:** empty, schematic, dialog (Settings sheet), command (⌘K)

## Assertions
- Settings mounts `data-slot=sheet-content` (ui/sheet)
- Command palette mounts `data-slot=command` (ui/command); no `.cmdk-backdrop`
- Companion grep: `scripts/design-system-dod-grep.mjs` (hex/select/primitive wiring)

## Shots
- light: empty/schematic/dialog/command @ 1440x900 — ui/sheet + ui/command asserted
- dark: empty/schematic/dialog/command @ 1440x900 — ui/sheet + ui/command asserted

**AGENTS.md §10:** may be checked only when this script + grep both exit 0.
**SHIPPABLE?** NO until all other DoD boxes are proven.
