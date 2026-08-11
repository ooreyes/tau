# Tau UI/UX Remediation Tracker

Authoritative baseline: `live-simulator-baseline-2026-08-11` at
`919f0e1070fdaa2310795f53ac56fa5431ba91ef`.

Sources:

- `/Users/omarreyes/Downloads/Untitled document.pdf` (2 pages)
- `/Users/omarreyes/Downloads/edits-to-fix.pdf` (7 pages)

This is the implementation contract for the PDF-directed UI/UX fleet. The
screenshots show reported states and may predate the current build. Reproduce
the current packaged app before changing code. If the current app already meets
an item, mark it `ALREADY SATISFIED` only with a test and current screenshot.

## Status and evidence contract

Allowed status values are `UNVERIFIED`, `CONFIRMED`, `IN PROGRESS`, `FIXED`,
`ALREADY SATISFIED`, and `BLOCKED`. Only the Luna orchestrator changes statuses
or checkboxes. A checked item must include the landing commit, tests with literal
results, before/after screenshots at matching state, and any residual risk.

Every implementation must preserve unmodified `.asc` import, exact attached or
user-installed model resolution, fail-closed named-device behavior, derived
netlists, undo/redo, design tokens, and the proprietary license. Hiding manual
model controls is a UI decision, not permission to delete model resolution.

Required visual matrix: light and dark themes; 900×600, 1280×800, and 1440×900;
empty editor, populated schematic, selected component, properties, and
simulator. Native Tauri/packaged evidence is authoritative; `dev:web` is useful
for responsive and console diagnosis but cannot prove ngspice or native chrome.

## Fleet ownership

| Wave | Lane | Issue ownership |
| --- | --- | --- |
| Bootstrap | shell seams | Behavior-preserving shell/Explorer/editor/inspector module boundaries |
| 1 | shell | SHELL-01, SHELL-03, SHELL-04, SHELL-05, SHELL-07 |
| 1 | electrical schema | SHELL-02, COMP-01, COMP-05, COMP-08B, COMP-09, COMP-11, COMP-12, COMP-13A |
| 1 | symbols | SHELL-06, COMP-03, COMP-07, COMP-08A, COMP-10, COMP-15, COMP-17 |
| 2 | inspector | COMP-02, COMP-04, COMP-06, COMP-08B, COMP-09, COMP-11, COMP-13B, COMP-14 |
| 2 | simulator | COMP-12 rendering, COMP-16 |
| 2 | regression | Cross-lane tests, accessibility, render/performance, dead duplicate UI code |
| 3 | native QA | Computer Use packaged-app matrix and before/after evidence |
| 3 | browser QA | Chrome `dev:web` responsive matrix and console evidence |
| 3 | engineering QA | Units, validation, models, representative circuits and simulation |

Split suffixes such as `COMP-08A/B` are lane subchecks; the stable issue remains
open until all of its subchecks pass.

## Application shell

### [ ] SHELL-01 - Collapse All is a reversible toggle

**Status:** IN PROGRESS
**Priority:** P1  
**Source:** Untitled document, page 1, item 1  
![Collapse control](screenshots/ui-ux-fix-brief/shell-01-collapse-toggle.png)

**Problem:** The Explorer action collapses everything but a second click does
not restore an expanded tree.

**Required behavior:** First activation collapses all expanded folders. The
next activation restores the exact prior expanded set. Repeated toggles remain
stable; changing projects clears stale restoration state.

**Acceptance/tests:** Cover nested folders, an already-collapsed tree, project
switching, keyboard activation, accessible label/state, and 900px-wide UI.

**Evidence:** implementation landed in `cad4a69` from worker `159e9088`;
focused shell suite **5 files / 75 passed**, integrated shell suite **6 files /
46 passed**, typecheck **exit 0**, and design drift **9 checks + 46 tests
passed**. Matching packaged light/dark 900×600/1280×800/1440×900 before/after
shots and keyboard/native QA remain pending; no completion claim yet.

### [ ] SHELL-02 - Simplify model-library UI without weakening the engine

**Status:** UNVERIFIED  
**Priority:** P0 engineering safety  
**Source:** Untitled document, page 1, item 2  
![Model controls](screenshots/ui-ux-fix-brief/shell-02-model-library-controls.png)

**Problem:** Vendor-model controls add visible complexity to the default UI.

**Required behavior:** Hide manual vendor-library authoring and device model
pickers from the default UI. Preserve exact document, attached, and
user-installed model lookup, model provenance, `.inc`/`.lib` import, and honest
refusal when a named model is unresolved. Do not substitute generic devices.

**Acceptance/tests:** Existing `.asc` model-resolution and named-device tests
remain green; default catalog/settings/inspectors expose no manual picker;
imported exact models still simulate or fail closed with the same diagnostics.

**Evidence:** pending electrical-schema lane implementation and Wave 3 model
fidelity QA.

### [ ] SHELL-03 - Preserve folder identity at narrow Explorer widths

**Status:** IN PROGRESS
**Priority:** P1  
**Source:** Untitled document, page 1, item 3  
![Narrow Explorer](screenshots/ui-ux-fix-brief/shell-03-narrow-explorer.png)

**Problem:** The project/folder name truncates before secondary toolbar actions
and the `PROJECT ROOT` caption yield space.

**Required behavior:** Keep the root folder name visible for as long as
possible. Hide or overflow secondary actions and `PROJECT ROOT` first, while
keeping every action keyboard-accessible through an overflow menu.

**Acceptance/tests:** Verify long Unicode folder names, 900×600, keyboard focus,
tooltips, and no horizontal page overflow.

**Evidence:** implementation landed in `cad4a69` from worker `159e9088`;
Explorer/shell focused assertions are green within the worker’s **5 files /
75 passed** and integrated **6 files / 46 passed** suites. Long Unicode and
900×600 packaged before/after evidence plus keyboard overflow QA remain
pending; no completion claim yet.

### [ ] SHELL-04 - Native macOS title-bar movement and zoom

**Status:** IN PROGRESS
**Priority:** P1 native  
**Source:** Untitled document, page 1, item 4  
![Title bar](screenshots/ui-ux-fix-brief/shell-04-titlebar.png)

**Problem:** The custom title bar does not reliably behave like native macOS
window chrome.

**Required behavior:** Dragging unused title-bar space moves the window;
double-clicking it zooms/restores according to macOS behavior. Interactive
controls remain excluded from the drag region and traffic lights stay usable.

**Acceptance/tests:** Prove in packaged Tauri with Computer Use at all three
sizes; test click, drag, double-click, traffic lights, tab controls, and focus.

**Evidence:** implementation landed in `cad4a69` from worker `159e9088`; native
title-bar contract assertions are included, worker focused shell suite is **5
files / 75 passed**, and typecheck is **exit 0**. Packaged Computer Use proof
of drag, double-click zoom/restore, traffic lights, controls, focus, and all
three sizes remains pending; no completion claim yet.

### [ ] SHELL-05 - Remove redundant bottom rail/settings/status clutter

**Status:** IN PROGRESS
**Priority:** P2  
**Source:** Untitled document, page 1, item 5  
![Bottom rail and status](screenshots/ui-ux-fix-brief/shell-05-settings-status.png)

**Problem:** The bottom Settings gear and adjacent status copy make the lower
left corner heavy and duplicate access already available elsewhere.

**Required behavior:** Remove the activity-rail gear and obsolete subordinate
copy shown in the source. Keep Settings reachable through the command palette
and application menu. Preserve meaningful simulation/document status elsewhere.

**Acceptance/tests:** Settings remains reachable by mouse and keyboard; no
orphan separator or blank reserved area; both themes and minimum height pass.

**Evidence:** implementation landed in `cad4a69` from worker `159e9088`;
focused shell suite **5 files / 75 passed**, design drift **9 checks + 46 tests
passed**, and typecheck **exit 0**. Both-theme/minimum-height screenshots and
command-palette/application-menu reachability evidence remain pending; no
completion claim yet.

### [ ] SHELL-06 - Keep component labels visually attached to symbols

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** Untitled document, page 2, item 6  
![Capacitor label spacing](screenshots/ui-ux-fix-brief/shell-06-capacitor-label.png)

**Problem:** The capacitor designator and value can sit far enough from the
body that ownership is ambiguous.

**Required behavior:** Use rotation- and mirror-aware label anchors that keep
designator/value clear of wires while visually attached to the component.

**Acceptance/tests:** Cover regular and polarized capacitors in all rotations,
mirror states, common values, imported label positions, and overlapping wires.

**Evidence:** commit / tests / before / after / risks

### [ ] SHELL-07 - Refine the navigation rail

**Status:** IN PROGRESS
**Priority:** P2  
**Source:** Untitled document, page 2, item 7  
![Navigation rail](screenshots/ui-ux-fix-brief/shell-07-navigation-rail.png)

**Problem:** The rail lacks the visual balance and state clarity expected from
the VS Code/Apple design direction.

**Required behavior:** Produce a compact, symmetric token-driven rail with
consistent hit targets, active/hover/focus states, icon alignment, separators,
and tooltips. Do not imitate VS Code colors literally.

**Acceptance/tests:** 44px-class targets where practical, visible keyboard
focus, no hardcoded colors, both themes, 900×600, and design-drift gate.

**Evidence:** implementation landed in `cad4a69` from worker `159e9088`;
worker shell suite **5 files / 75 passed**, design drift **9 checks + 46 tests
passed**, and typecheck **exit 0**. Matching light/dark 900×600/1280×800/1440×900
shots plus keyboard focus/hit-target QA remain pending; no completion claim yet.

## Components and properties

### [ ] COMP-01 - One coherent independent-source workflow

**Status:** UNVERIFIED  
**Priority:** P0 compatibility  
**Source:** edits-to-fix, page 1, item 1  
![DC source properties](screenshots/ui-ux-fix-brief/comp-01-unified-source-dc.png)
![Source waveform menu](screenshots/ui-ux-fix-brief/comp-01-unified-source-waveforms.png)

**Problem:** Separate DC, AC, and pulse catalog devices make source selection
confusing even though the inspector already presents waveform choices.

**Required behavior:** Offer one voltage-source and one current-source catalog
entry with waveform selection for DC, sine, pulse, PWL, exponential, and FM,
plus small-signal AC properties where electrically valid. Existing serialized
kinds and imported LTspice source syntax remain readable and round-trip without
loss; this is not a destructive persistence migration.

**Acceptance/tests:** Place/configure every waveform, save/reopen, undo/redo,
import/export representative LTspice spelling, build the correct deck, and
verify transient/AC results. Remove duplicate placement entries only.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-02 - Align property controls into stable columns

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 2, item 2  
![Property alignment](screenshots/ui-ux-fix-brief/comp-02-property-alignment.png)

**Problem:** Values, units, dropdowns, and toggles do not share consistent
columns, making vertical scanning difficult.

**Required behavior:** Use shared label/control/unit columns with numeric text
right-aligned and controls sized consistently. Collapse gracefully rather than
overlap at narrow inspector widths.

**Acceptance/tests:** DC, sine, pulse, checkbox, select, text, invalid state,
long unit, and 900×600 screenshots in both themes.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-03 - Give the current-source glyph enough interior space

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 2, item 3  
![Current source glyph](screenshots/ui-ux-fix-brief/comp-03-current-source-spacing.png)

**Problem:** The sine wave and current arrow are constricted and collide inside
the source circle.

**Required behavior:** Preserve standard current-source semantics while giving
both marks clear separation at normal and selected stroke widths.

**Acceptance/tests:** DC/sine current sources, rotations, mirror, selected,
dark/light, hit bounds, pin geometry, and snapshot/geometry tests.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-04 - Apply inspector alignment to every component family

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 3, item 4  
![Pulse inspector alignment](screenshots/ui-ux-fix-brief/comp-04-inspector-alignment.png)

**Problem:** The alignment defect is systemic, including hints such as duty
range competing with the value and unit.

**Required behavior:** Move all component property groups onto the shared row
primitive. Hints and errors receive their own predictable line and never shift
the value/unit columns.

**Acceptance/tests:** Audit every catalog component automatically for native
inputs/selects, overflow, missing labels/units, and shared row usage; visually
sample each family.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-05 - Ground has identity, not an electrical value

**Status:** UNVERIFIED  
**Priority:** P0 correctness  
**Source:** edits-to-fix, page 3, item 5  
![Ground properties](screenshots/ui-ux-fix-brief/comp-05-ground-properties.png)

**Problem:** Ground accepts an arbitrary value, which has no electrical meaning.

**Required behavior:** Remove value editing. Offer an optional display label
only if supported without changing node-zero semantics. New Ground placements
face upward by default; imported orientation remains unchanged.

**Acceptance/tests:** Node `0` deck behavior, placement, all rotations,
save/reopen, imported ground, undo/redo, and absence of meaningless units.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-06 - Movable properties and friendly component identity

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 4, item 6  
![Movable properties](screenshots/ui-ux-fix-brief/comp-06-movable-properties.png)

**Problem:** The floating properties surface can obscure the component and the
term `Refdes` is unnecessarily cryptic.

**Required behavior:** Dragging the header moves the surface within the editor
bounds; its position remains usable after resize. Rename the user-facing label
to `Component ID` while retaining `refdes` internally and in file formats.

**Acceptance/tests:** Mouse and pointer drag, resize clamping, close/reopen,
keyboard access, 900×600, and no persistence/schema rename.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-07 - Correct polarized-capacitor geometry

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 4, item 7  
![Polarized capacitor](screenshots/ui-ux-fix-brief/comp-07-polarized-capacitor.png)

**Problem:** The negative-side lead visually cuts through the curved plate.

**Required behavior:** Terminate each lead at its plate with a visible gap and
retain polarity clarity, pin coordinates, hit bounds, rotation, and mirror.

**Acceptance/tests:** Geometry assertions plus selected/unselected screenshots
at every orientation in both themes.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-08 - LED geometry and useful electrical properties

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 4, item 8  
![LED properties](screenshots/ui-ux-fix-brief/comp-08-led-properties.png)

**Problem:** Emission arrows crowd each other; useful color and forward-voltage
controls are missing; a long ideal-model paragraph consumes the inspector.

**Required behavior:** `COMP-08A` spaces arrows cleanly. `COMP-08B` adds an LED
color selector and validated forward voltage defaulting to 2 V for generic new
LEDs, removes the paragraph, and preserves imported exact models. Color affects
visual emission only unless an explicit physical model defines behavior.

**Acceptance/tests:** New/imported LED, supported colors, valid/invalid voltage,
deck behavior, save/reopen, simulator indication, both themes, and no silent
replacement of named models.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-09 - Replace Zener prose with editable parameters

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 5, item 9 (text-only note)

**Problem:** A long explanation displaces the settings engineers need.

**Required behavior:** Remove long prose and expose concise validated generic
Zener parameters with typical defaults. Imported exact models remain exact and
show concise provenance rather than editable fake equivalents.

**Acceptance/tests:** Generic and named Zener, invalid ranges, deck cards,
save/reopen, exact-model preservation, and inspector density.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-10 - Correct photodiode arrow spacing

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, page 5, item 10 (same geometry class as LED)  
![Related LED arrow geometry](screenshots/ui-ux-fix-brief/comp-08-led-properties.png)

**Problem:** Incoming-light arrows are too close to one another and the body.

**Required behavior:** Space arrows consistently, preserve inward direction,
and keep geometry clear at all rotations and selection strokes.

**Acceptance/tests:** Geometry assertions and both-theme screenshots for every
orientation, with pin/hit bounds unchanged.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-11 - Hide manual model pickers while preserving fidelity

**Status:** UNVERIFIED  
**Priority:** P0 engineering safety  
**Source:** edits-to-fix, page 5, item 11  
![PNP parameters](screenshots/ui-ux-fix-brief/comp-11-pnp-properties.png)
![NPN parameters](screenshots/ui-ux-fix-brief/comp-11-npn-properties.png)
![PMOS parameters](screenshots/ui-ux-fix-brief/comp-11-pmos-properties.png)
![NMOS parameters](screenshots/ui-ux-fix-brief/comp-11-nmos-properties.png)

**Problem:** BJT/MOSFET and other model-backed inspectors expose model-library
management instead of focused generic parameters.

**Required behavior:** Hide manual picker/import controls in default component
properties. Generic catalog devices expose validated typical parameters.
Named/imported devices retain immutable exact model identity/provenance and may
not fall back to generic parameters.

**Acceptance/tests:** Generic BJT/MOSFET/JFET/diode/op-amp/switch, exact imported
models, missing models, attached libraries, decks, diagnostics, and
named-device-fidelity zero-silent-substitution proof.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-12 - Type and range validation for every property

**Status:** UNVERIFIED  
**Priority:** P0 correctness  
**Source:** edits-to-fix, page 6, item 12  
![Invalid logic constant](screenshots/ui-ux-fix-brief/comp-12-logic-validation.png)

**Problem:** Inputs can display nonsensical text, units, or ranges, such as a
logic constant of `103 V`.

**Required behavior:** Every editable parameter has parse, finite/range, and
domain validation. Invalid text keeps the draft visible, uses token-based error
styling, exposes an inline expectation and accessible error association, and
does not mutate the schematic until valid. Logic constant accepts only 0 or 1,
has no voltage unit, and renders that state on its symbol.

**Acceptance/tests:** Empty, partial, exponent, engineering suffix, NaN,
Infinity, below/above range, invalid enum, keyboard commit/cancel, undo, screen
reader attributes, and representative fields from every component family.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-13 - Repair the generic op-amp inspector

**Status:** UNVERIFIED  
**Priority:** P0 correctness  
**Source:** edits-to-fix, page 6, item 13  
![Current op-amp inspector](screenshots/ui-ux-fix-brief/comp-13-opamp-current.png)
![Requested generic parameters](screenshots/ui-ux-fix-brief/comp-13-opamp-target.png)

**Problem:** Rows overlap, manual model UI dominates, and useful generic circuit
parameters are absent.

**Required behavior:** `COMP-13A` defines validated generic gain and min/max
output defaults consistent with Tau's generic op-amp model. `COMP-13B` presents
them in the shared inspector rows. Exact imported op-amps retain exact models;
Tau must not pretend the generic controls describe a vendor macro-model.

**Acceptance/tests:** Generic op-amp deck and clipping behavior, invalid
min/max order, named/imported models, save/reopen, both themes, and narrow width.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-14 - Remove long component-property essays

**Status:** UNVERIFIED  
**Priority:** P2  
**Source:** edits-to-fix, page 6, item 14  
![Long description](screenshots/ui-ux-fix-brief/comp-14-long-description.png)

**Problem:** Paragraph-length explanations overwhelm routine properties.

**Required behavior:** Remove prose from all inspectors. Preserve only concise
field help, actionable validation, tooltips, and accessibility descriptions.
Unsupported or refusal diagnostics remain explicit and are not hidden.

**Acceptance/tests:** Automated inspector audit for long description blocks;
contextual help and all failure diagnostics remain reachable.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-15 - Make dense digital symbols legible

**Status:** UNVERIFIED  
**Priority:** P1  
**Source:** edits-to-fix, pages 6-7, item 15  
![Dense digital labels](screenshots/ui-ux-fix-brief/comp-15-digital-labels.png)

**Problem:** Latch/flip-flop pin labels such as COM, CLR, PRE, and CLK crowd or
overlap the body and each other.

**Required behavior:** Audit all high-pin-count symbols; reposition labels,
use conventional names, and add tooltips/accessible full names where an
abbreviation is necessary. Electrical pin identities and imported pin mapping
must not change.

**Acceptance/tests:** Every rotation/mirror, all latch/flip-flop kinds,
pin-connection tests, imported mapping, collision geometry, and both themes.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-16 - Simulate a real seven-segment display

**Status:** UNVERIFIED  
**Priority:** P1 simulation  
**Source:** edits-to-fix, page 7, item 16 (source calls it an 8-bit segment)

**Problem:** The seven-segment component does not visibly show active segments
or the represented digit in Simulator.

**Required behavior:** Derive each segment's active state from the actual
simulation nodes. Illuminate active segments with a semantic design token that
reads as physical red in both themes. Show the corresponding digit for valid
0-9 patterns; for non-digit patterns, show the driven segments without inventing
a number. Do not store derived display state in the schematic.

**Acceptance/tests:** Digits 0-9, blank, invalid/multiple patterns, common
anode/cathode semantics supported by the component, stopped/no-result state,
live updates, both themes, and no hardcoded color outside token policy.

**Evidence:** commit / tests / before / after / risks

### [ ] COMP-17 - Remove the unnecessary switch rectangle

**Status:** UNVERIFIED  
**Priority:** P2  
**Source:** edits-to-fix, page 7, item 17  
![Switch rectangle](screenshots/ui-ux-fix-brief/comp-17-switch-rectangle.png)

**Problem:** An open rectangle below the switch appears visually unrelated.

**Required behavior:** Trace whether it represents an actuator/control port. If
decorative or redundant, remove it and tighten bounds. If electrically
meaningful, redesign it into an unambiguous standard control indication rather
than deleting a pin or capability.

**Acceptance/tests:** Static and controlled switches, open/closed simulator
states, pin/hit bounds, rotation/mirror, imported mappings, and both themes.

**Evidence:** commit / tests / before / after / risks

## Completion matrix

- [ ] All 24 stable issues are `FIXED` or evidence-backed `ALREADY SATISFIED`.
- [ ] No issue remains `UNVERIFIED`, `IN PROGRESS`, or `BLOCKED`.
- [ ] Every issue has commit, literal test result, and matching visual evidence.
- [ ] Light/dark and 900×600, 1280×800, 1440×900 matrices pass.
- [ ] Computer Use proves packaged native interactions and resizing.
- [ ] Chrome proves responsive `dev:web` behavior with no console errors.
- [ ] Typecheck, frontend tests, design drift, minimum-window, production build,
      applicable Rust/native gates, and packaged-ngspice smoke pass.
- [ ] Exact model/import behavior and named-device fail-closed guarantees remain.
- [ ] Final Sol High review has no unresolved actionable findings.
- [ ] `auto/ltspice-parity` is clean and pushed; no fleet worktrees or branches
      remain; nothing is merged to `main`.
