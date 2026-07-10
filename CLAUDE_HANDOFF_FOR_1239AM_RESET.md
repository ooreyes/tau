# Claude startup context for Tau — after limit reset at 12:39am

This file is intended to be read by Claude automatically via `CLAUDE.md` when
the next Claude session starts. It captures Omar's requested focus so the bot is
ready to begin work without a broad clarification round.

---

You are working in:

```bash
/Users/omarreyes/Desktop/Tau
```

Follow `AGENTS.md` exactly. This repo uses the single active branch:

```bash
auto/ltspice-parity
```

Current known state from Codex inspection:

- Branch: `auto/ltspice-parity`
- Latest local/remote commit: `4e9c2a0 ui: EDA-true wire tool icon — orthogonal dogleg with junction endpoints (§UX checklist icons)`
- `PROGRESS.md` heartbeat was `DONE`.
- Headline metric in heartbeat: `1383 tests green · corpus 82/82 import · 82/82 op-converge · 79/82 warning-clean`

Start every implementation run with the AGENTS sync loop:

```bash
git fetch origin
git switch auto/ltspice-parity 2>/dev/null || git switch -c auto/ltspice-parity origin/auto/ltspice-parity
git reset --hard origin/auto/ltspice-parity
pnpm install
```

Then read:

```bash
sed -n '1,80p' PROGRESS.md
rg -n "§10|Simulator|simulation|probe|measurement|resizable|Fit to View|Errors" FEATURE_PARITY.md apps/desktop/src -S
```

Do not re-read giant files unless needed. Pick small vertical units, update the heartbeat, implement, test, commit, and push. Required push gates:

```bash
pnpm -C apps/desktop typecheck
pnpm -C apps/desktop test
```

For native/engine/release changes also run the Rust/build gates from `AGENTS.md`.

Every commit message must include:

```text
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Product direction from Omar

We already discussed redesigning the schematic UI, improving icons, enforcing one net label per node, improving LTspice `.asc` import, cleaning up current-flow visualization, and making the app feel like Apple + Palantir + a serious engineering tool.

Now focus on simulator UI, schematic refinements, resizable panels, graph scaling, and component/node measurements.

Goal:

Make Tau/Cow feel simple, polished, and powerful. A user should be able to build a circuit, click/run once, and immediately understand voltages, currents, power dissipation, oscillations, and errors without manually configuring simulation internals.

Do not ask broad questions. Inspect the codebase, make sensible decisions, implement carefully, and explain what changed.

Core UX principles:

- Apple-like polish: clean spacing, system typography, subtle surfaces, strong hierarchy.
- Engineering clarity: data must be accurate, readable, and traceable back to the schematic.
- Progressive disclosure: basic users see simple controls; advanced simulation settings are hidden under “Advanced.”
- Direct manipulation: probes/components selected in schematic should appear clearly in simulator outputs.
- No redundant controls or clutter.

## Relevant code pointers already found

Likely areas:

- `apps/desktop/src/components/ShellPanels.tsx`
  - top toolbar Run button around the `transport-play` control
  - errors panel/tab UI
  - properties/settings area
  - project/power-board tree/sidebar layout
- `apps/desktop/src/components/SimulationPanel.tsx`
  - simulator tab layout
  - redundant simulator run/stop controls
  - probe-driven traces
  - measurement tables
  - plot components
- `apps/desktop/src/store/useSchematic.ts`
  - probes
  - selected component/wire/label/probe state
  - one-probe-per-net behavior already exists
- `apps/desktop/src/simulation/currentProbe.ts`
  - component current probe traces
- `apps/desktop/src/simulation/axisTicks.ts`
  - plot axes/tick formatting
- `apps/desktop/src/simulation/quantity.ts`
  - engineering-unit formatting
- `apps/desktop/src/simulation/measure*.ts`
  - `.meas` machinery
- `apps/desktop/src/simulation/linearTransient.ts`
  - transient results and currents
- `apps/desktop/src/App.css` and design-token files
  - use semantic tokens; do not hardcode colors

## Requested work backlog

### 1. Empty properties panel state

The properties panel looks ugly when no component is selected.

Requirements:

- When nothing is selected, show a clean empty state.
- Title: “No Selection”
- Helper: “Select a component, wire, node, or label to view and edit its properties.”
- Include a subtle icon or schematic-style glyph.
- Do not show messy placeholders, broken fields, or irrelevant controls.
- Keep visually quiet and intentional.

### 2. Resizable side panels

Make the properties panel and project/power-board tree resizable.

Requirements:

- Properties panel: draggable left border.
- Project/tree panel: draggable right border or relevant layout boundary.
- Persist resized widths during the session; use local storage/preferences if already available.
- Add min/max widths.
- Cursor changes on hover/drag.
- Smooth dragging, no layout jitter.

Relevant tree labels include:

- Analog changing circuit
- LED board
- Power stage

### 3. Fit to View padding

Current “Fit to View” zooms too tightly.

Requirements:

- Add padding around fitted schematic bounds.
- Suggested default: 10–15% viewport padding or at least 48–80 px.
- Never zoom so components touch canvas edge.
- Works for small/large schematics.
- Works with selected-object fit and full-canvas fit if both exist.
- Add tests if geometry utilities exist.

### 4. Errors tab/status polish

Requirements:

- If no errors:
  - show checkmark or clean success indicator
  - copy like “No errors.”
  - subtle success green or neutral success state
- If errors:
  - prominent error color
  - count, e.g. “Errors 3”
- Use semantic design tokens: success, warning, error, neutral.
- Match Run button visual language.

### 5. Simulator graph layout

Graph currently dominates the screen.

Requirements:

- Redesign simulator layout so plots are contained in readable panels/cards.
- Reasonable max height.
- Dashboard layout:
  - top: compact simulation summary/status
  - middle: selected plots in cards/panels
  - side or bottom: measurements table/list
  - advanced settings collapsed
- Multiple probes/signals should stack or tab cleanly.
- Axes, legends, labels remain readable.

### 6. Remove redundant Run button

Requirements:

- Keep one primary Run control in the main/top toolbar.
- Remove loud duplicate Run button inside simulator tab.
- Simulator tab can show status and maybe a subtle secondary rerun action only if truly needed.

### 7. Hide advanced simulation settings

Requirements:

- Move resolution/sample-rate/samples-per-cycle/step-size style controls into collapsed “Advanced Simulation Settings.”
- Default flow:
  1. Build circuit.
  2. Place probes/select components.
  3. Click Run.
  4. View voltages, currents, power, plots, warnings.
- Add helper text: Tau automatically chooses simulation settings unless overridden.

### 8. Automatic simulation resolution/settings

Implement or improve auto-resolution.

Requirements:

- Infer timestep/sample settings from circuit and simulation type.
- Transient:
  - estimate RC/RL time constants when possible
  - consider source frequencies
  - choose timestep small enough for waveform shape
  - avoid excessive samples
- AC:
  - choose sensible sweep defaults from source/circuit values where possible
- Integrate with existing simulation API.
- If complete inference is not possible, use documented heuristic.
- Advanced overrides still work.

### 9. Node probes instantly appear in simulator

Requirements:

- Colored schematic probes automatically create simulator traces.
- Probe colors match plot trace colors.
- Show node name/generated ID and voltage.
- Time-varying signals plot over time.
- Steady-state signals show scalar clearly.
- Oscillating signals show range/stats.

Note: some probe machinery already exists. Verify it works end-to-end and polish the UI.

### 10. Component measurements

For named components, expose:

- Voltage across component
- Current through component
- Power dissipated/delivered
- RMS where relevant
- Average where relevant
- Min/max where relevant

Requirements:

- Visible in simulator tab.
- Identify by refdes, e.g. R1, C1, V1.
- Selecting component in schematic highlights/focuses its measurements in simulator.
- If component is probed, show traces.
- Resistors: current, voltage, power dissipated.
- Sources: show delivered vs absorbed power.
- Correct sign conventions; document in compact UI/help text if needed.

### 11. Oscillation/waveform detection

Requirements:

- Detect steady, transient, periodic, or oscillating signals.
- Oscillating:
  - plot it
  - show min, max, average, RMS
  - optionally approximate frequency/period
- Mostly steady:
  - show final value and small sparkline if useful
- Do not hide dynamics behind a single static value.

### 12. Plot statistics by default

Each visible trace should expose:

- Max
- Min
- Average
- RMS
- Final value
- Units
- Optional frequency/period if oscillating

UI requirements:

- Compact legend, hover card, or side panel.
- Do not clutter graph.
- Use clean Apple-level data visualization: precise, readable, quiet.
- Use consistent engineering units: mV/V/kV, µA/mA/A, mW/W, ns/µs/ms/s.

## Suggested implementation sequencing

Prefer small, shippable units:

1. UI polish unit:
   - empty properties state
   - errors tab status
   - fit-to-view padding
   - tests if geometry/status utilities exist

2. Resizable panels unit:
   - project tree width
   - properties width
   - localStorage/session persistence
   - min/max width constraints

3. Simulator layout unit:
   - remove redundant simulator Run button
   - convert plot area to dashboard/card layout
   - collapse advanced settings
   - keep existing simulation behavior unchanged

4. Measurement summary unit:
   - trace statistics utility with tests
   - min/max/avg/RMS/final/frequency heuristic
   - display stats in compact simulator UI

5. Component measurements unit:
   - derive voltage/current/power per named component
   - focus selected schematic component’s measurements
   - tests on simple resistor/source circuits

6. Auto-resolution unit:
   - inspect existing analysis setup and transient source parsing
   - implement conservative heuristic
   - document limitations
   - tests for RC/source-frequency cases

Always avoid broad refactors. Keep schematic as source of truth; netlists are derived. Do not fake simulation data. Keep unsupported behavior explicit.
