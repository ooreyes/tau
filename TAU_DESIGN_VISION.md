# Tau Product & Design Vision

**Status:** Active implementation contract  
**Owner:** Root orchestrator; all agents must read this file before UI work  
**Updated:** 2026-07-15
**North star:** a macOS-first, engineering-grade LTspice replacement that opens,
edits, simulates, and saves unmodified `.asc` files without making the user learn
Tau-specific project conventions.

This file is the durable continuation point for the current product overhaul.
It turns the visual references (Apple / Anduril / Palantir / Desmos / LTspice)
into concrete, testable decisions. It does not authorize fake simulation data or
decorative controls that do nothing.

## 1. Product principles

1. **The circuit and its measurements are the product.** Chrome recedes; plots,
   topology, errors, measurements, and file identity stay visually dominant.
2. **Progressive disclosure without hidden essentials.** Voltage/current/power,
   active traces, axes, cursor values, run state, and errors are visible without
   opening a drawer. Advanced solver knobs and uncommon exports may disclose.
3. **Direct manipulation.** Probe a node to create a plot, drag cards to arrange
   them, resize plots from their edges, drag cursors on the graph, double-click an
   axis to fit it, and use wheel/pinch zoom at the pointer.
4. **Mac-native productivity.** Folder projects, keyboard shortcuts, menus,
   precise pointer input, persistent layouts, and user-customizable workspaces.
   This follows Apple's [macOS design guidance](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/).
5. **Truth over decoration.** Every status color and displayed number derives
   from real document/simulation state. No fabricated waveforms or measurements.

## 2. Visual language: precision instrument with restrained glass

Tau is an instrument, not a neon dashboard. The base is an optically neutral
graphite/black content layer with selective depth:

- **Content layer:** opaque, high-contrast schematic and plot surfaces. No blur
  behind dense graphs, tables, or engineering text.
- **Navigation layer:** toolbars, floating controls, command palette, contextual
  inspectors, and transient popovers may use a restrained glass material: subtle
  translucency, 0.5–1 px highlight edge, muted background blend, and a small
  elevation shadow. Glass communicates hierarchy; it is never wallpaper.
- **Selection:** warm ice/graphite edge + faint neutral fill. Selection and focus
  remain obvious without turning the schematic or chrome blue.
- **Status:** green = valid/complete, amber = running/warning/stale, red = invalid/
  failed. Status color belongs on a small lamp, count, or local message—not a
  full-width success wash. Always pair color with icon/text.
- **Traces:** a colorblind-considered ordered palette with luminance separation;
  repeated traces also vary dash/marker treatment. Trace colors never become UI
  accent colors.

This applies Apple's guidance to choose material for semantic structure, preserve
contrast, and use color sparingly rather than tinting every surface:
[Materials](https://developer.apple.com/design/human-interface-guidelines/materials),
[Color](https://developer.apple.com/design/human-interface-guidelines/color).

### Semantic surface tokens

All colors remain design tokens. UI code must not contain literal colors.

| Token role | Meaning |
| --- | --- |
| `--bg` | window content background |
| `--panel` / `--panel-2` | primary and nested opaque surfaces |
| `--material-thin` | floating/navigation glass only |
| `--border` / `--border-strong` | structural hairlines |
| `--text` / `--muted` / `--faint` | three levels of text hierarchy |
| `--accent` | selected/interactive focus |
| `--success` / `--signal` / `--danger` | valid, warning/running, invalid |
| `--scope-surface` / `--grid-*` | engineering plot canvas and grid |

## 3. Typography and icons

- **UI:** SF Pro through `-apple-system, BlinkMacSystemFont, "SF Pro Text"`.
  Default 13 px; never below 10 px, matching Apple's macOS guidance.
- **Engineering data:** SF Mono / ui-monospace for node names, expressions,
  coordinates, units, numerical readouts, and shortcuts only.
- **Hierarchy:** size/weight first, color second. Avoid uppercase body copy and
  excessive letter spacing. Analysis abbreviations (`TRAN`, `OP`, `AC`) may stay
  uppercase because they are domain symbols.
- **Icons:** one coherent 16/18 px outline family, 1.6 stroke, round joins. Prefer
  SF Symbols semantics; use Lucide equivalents in React. Do not mix emoji,
  arbitrary Unicode, filled glyphs, and outline icons in the same control row.
- **Icon-only controls:** 28×28 minimum desktop target, tooltip, accessible name,
  hover/focus/pressed states, and no decorative nonfunctional buttons.

Reference: Apple's [Typography guidance](https://developer.apple.com/design/human-interface-guidelines/typography).

## 4. Information architecture

```text
Window
├── Title / mode / run state
├── Activity rail
├── Schematic workspace
│   ├── Schematics folder explorer
│   ├── editable canvas
│   ├── shared properties / components / assistant dock
│   └── errors strip
└── Simulator workspace
    ├── read-only circuit context
    ├── analysis dashboard (resizable/reorderable cards)
    ├── always-visible measurement dock
    └── optional advanced tools (never overlays primary plots)
```

Panels may resize or collapse, but primary plots and measurements must not live
behind sliding overlays. At the minimum window size the layout reflows into a
vertical document stream with sticky local headers; it must not squeeze columns
until labels or controls become unreachable.

## 5. `.asc`-native Schematics workspace

1. The Explorer root is a user-selected folder and displays its real basename.
   No hardcoded “Powerboard,” example boards, or automatic example document.
2. The first-run state offers **Open Schematics Folder**, **Create Schematics
   Folder**, and **Import `.asc`**. In a browser without filesystem access, use a
   clearly labeled temporary `Schematics` workspace with no seeded examples.
3. New File creates a valid blank `untitled.asc` by default. `.sim` remains a
   legacy/internal format, not the primary user workflow.
4. Opening `.asc` preserves its filename and source path. Saving an `.asc` uses
   Tau's ASC exporter; it must never write Tau JSON into an `.asc` path.
5. Import copies the original text into the chosen folder and opens it. Warnings
   are visible and actionable; unsupported content is never silently discarded.
6. Folder actions mirror a real editor: new file/folder, rename, delete, refresh,
   collapse all, reveal/open folder, and keyboard navigation.
7. Once a project is open, Open/Import are compact toolbar actions—not a large
   footer that competes with the file tree. Native folder creation, file
   creation, and moves all cross the same root-scoped command boundary; a newly
   created folder accepts nested files immediately and moves round-trip to root.

## 6. Simulator architecture

### Analysis navigation

- Replace the oversized equal-width `TRAN / OP / AC / DC / TF / NOISE / STEP`
  slab with a compact, content-sized segmented rail (28–32 px high).
- Active mode uses a neutral raised material and stronger text; inactive modes
  remain quiet but legible. All modes fit at the minimum width without
  horizontal scrolling. The selected mode includes one plain-language sentence
  describing why an engineer would use it.
- A mode switch never destroys its last result or user layout.
- Dedicated sine-source metadata may say “Sine source.” Sampled waveforms are
  described as “Periodic” unless Tau can prove their shape; never infer sine
  from repetition alone.

### Plot cards

- Auto-create one plot card per probed/named signal; combine compatible traces
  only when the user chooses. Component cards show voltage, current, and power.
- Cards are resizeable and reorderable. Layout persists per schematic. Provide
  **Auto layout**, **Fit all**, **Add trace**, and **Reset workspace**.
- Each card keeps its title, trace legend, unit, run/stale state, and a compact
  min/mean/max/RMS/peak-to-peak readout visible. Detailed statistics disclose
  inside the card, not in a remote pane.
- Plots use real major/minor ticks that refine as the user zooms. Pointer-centered
  wheel/pinch zoom, drag pan, box zoom, axis-only zoom, home/fit, and reset are
  consistent across TRAN/AC/DC/FFT.
- **Auto Frame** means “show the interesting signal”: for a classified periodic
  trace, frame the last four periods and fit Y to visible samples; for aperiodic
  data, use the full run. **Full Run** remains a distinct action. A 100 kHz trace
  over 7 ms must not look like an opaque block merely because 700 cycles were
  compressed into one viewport.

### Cursors and FFT

- Two LTspice-style cursors live directly on the graph and snap to samples/peaks.
  The always-visible readout shows X1/Y1, X2/Y2, ΔX, ΔY, 1/ΔX, slope, and trace.
- Keyboard nudging moves by 1/10/100 samples; cursor identity and trace binding
  are explicit.
- FFT shows window, bin width, sample count, fundamental, harmonics, noise floor,
  THD/THD+N when computable, and logarithmic frequency navigation. Peak markers
  and harmonic table select the same underlying data.
- Use LTspice interaction expectations as compatibility guidance, including
  probe-on-wire plotting and two measurement cursors:
  [Analog Devices LTspice getting started](https://ez.analog.com/design-tools-and-calculators/ltspice/a/faqs-docs/c/getting-started-with-ltspice).

### Assistant and local inference

- Components and the Assistant are independent tools. Opening the Assistant must
  not hide the component library. At normal desktop widths they are direct,
  independently resizable sibling columns—not an overlay and not a vertically
  split pseudo-panel. At Tau's exact 900px minimum, Components + Assistant stay
  together and the passive Explorer yields first; explicitly selecting Explorer
  swaps it with Components, and closing Assistant restores Explorer.
- The Assistant always receives a bounded, serialized view of the active
  schematic. A request to change the circuit produces a typed operation or a
  complete validated ASC proposal, never direct filesystem writes or hidden
  canvas mutation. Tau owns symbol legality, grid placement, routing,
  connectivity, duplicate-name checks, undo, dirty state, and analysis
  invalidation. The user sees the proposed action and confirms before apply.
- Cloud and local inference use the same provider-neutral action boundary. The
  local provider binds only to `127.0.0.1:8080`; Tau must not
  silently download multi-gigabyte weights, expose the server to the LAN, or
  describe a small model as an autonomous electrical engineer.
- Apple Silicon reference runtime: Apple's
  [MLX LM](https://github.com/ml-explore/mlx-lm), which supports quantized
  models, streaming, prompt caching, and an OpenAI-compatible localhost server.
  Recommended starting tiers are the official Apache-2.0
  [Qwen3 1.7B MLX 4-bit](https://huggingface.co/Qwen/Qwen3-1.7B-MLX-4bit)
  as a lighter explanation-first fallback and
  [Qwen3 4B MLX 4-bit](https://huggingface.co/Qwen/Qwen3-4B-MLX-4bit)
  as the recommended circuit-plan model. Its measured 3.5 GB peak native
  process footprint fits the 8 GB target with limited headroom; 16 GB remains
  the more comfortable tier for Tau, ngspice, and the model together.

The shipped local protocol is not free-form ASC. Qwen calls
`build_tau_circuit` with catalog kinds, values, and exact `ref.pin` net members.
Tau now accepts 45 fixed-pin/library kinds
(`ASSISTANT_GENERATABLE_KINDS`, `apps/desktop/src/lib/assistantCircuitPlan.ts:60`).
Thirty-five round-trip as exact stock symbols
(`ASSISTANT_DIRECT_GENERATABLE_KINDS`, same file line 42); the ten composite
kinds — CCCS, CCVS, comparator, potentiometer, static switch, push button,
relay, motor, transformer, and CT transformer (`ASSISTANT_COMPOSITE_KINDS`,
line 55) — lower into electrically equivalent LTspice primitives (including
explicit sense branches and K coupling). Tau validates references, kinds, values, pins,
single-net membership, ground, and directives; assigns a deterministic graph
layout; obstacle-routes the wires; serializes and re-imports ASC; then proves the
requested physical net partition is still connected and isolated. An invalid
plan gets at most two private, validation-specific repair attempts. If MLX drops
a native tool payload, Tau retries as one whole-body JSON operation through the
same compiler. No model response writes a file or mutates the canvas directly.

#### Reproducible M1 Pro benchmark (2026-07-14)

Hardware: M1 Pro, 16 GB unified memory, macOS 26.5; `mlx-lm` 0.31.3 and
MLX 0.32.0. Both models ran locally with thinking disabled.

| Model | Download shown by model card | Prompt | Generation | Peak model memory | Tau edit result |
| --- | ---: | ---: | ---: | ---: | --- |
| Qwen3 1.7B MLX 4-bit | 914 MB | 92.4 tok/s | 52.9 tok/s | 1.40 GB | Failed whole-ASC task; a narrow typed resistor operation succeeded separately at 70.2 tok/s and 1.12 GB |
| Qwen3 4B MLX 4-bit | about 2.3 GB | 150.3 tok/s | 42.5 tok/s | 2.77 GB benchmark / 3.5 GB live-plan peak | Passed live protected-LED, powered inverting-amplifier, and 1:2 transformer requests through placement, routing, ASC/topology validation, and confirmation-gated actions |

The benchmark establishes feasibility, not electrical correctness. The 1.7B
model is suitable for explanations and narrow typed operations, but is below
Tau's bar for reliable multi-part circuit plans. The 4B model is the default on
8 GB and larger Macs, still behind strict validation, bounded repair, and user
confirmation. MLX-LM's own server documentation describes the HTTP server as a
local endpoint with basic—not production-grade—security; Tau therefore fixes
host, port, origins, repository allowlist, and renderer CSP rather than exposing
server configuration. A full model-authored ASC replacement remains a cloud
compatibility fallback, not the local-LLM protocol.

## 7. Motion and feedback

- No current-flow wire animation until the simulation is trustworthy enough to
  make it engineering information.
- Motion is short (120–220 ms), interruptible, and limited to hierarchy changes:
  material settling, card reflow, disclosure, focus, and run-state transitions.
- Respect `prefers-reduced-motion`. Never animate plot data merely for polish.

## 8. Acceptance checklist for every UI unit

- Real functionality has tests; no dead buttons.
- Typecheck + focused tests + full desktop tests pass.
- Screenshot/browser QA at 1440×900, 1280×720, and 900×600.
- Keyboard-only path, visible focus, accessible name, contrast, and reduced-motion
  behavior checked.
- No hardcoded colors outside the token block; no new one-off font stacks.
- No primary data hidden behind an overlay or clipped at minimum size.
- For `.asc`, round-trip save is proven with a parse/export/reimport test.

## 9. Implementation sequence

1. `.asc`-native Schematics workspace and removal of seeded Powerboard content.
2. Simulator analysis rail and persistent responsive dashboard shell.
3. Unified plot cards, axes, zoom, cursors, and at-a-glance statistics.
4. FFT engineering detail and harmonic interaction.
5. Material/palette/type/icon consistency sweep and light/high-contrast variants.
6. Packaged Tauri screenshot and native ngspice acceptance pass.

## 10. Baseline UI/UX audit — 2026-07-14

Live review covered the supplied analysis-tab screenshot plus Tau at the normal
desktop viewport and the declared 900×600 minimum, before this contract's new
units landed.

### What is already working

- The simulator keeps a read-only circuit beside analysis instead of replacing
  the editor with an unrelated full-screen chart.
- The current seven-mode rail is keyboard/ARIA-addressable and, in the dirty
  working build, fits the 542 px analysis column at 900×600.
- Run state, Errors, and component telemetry already derive from real analysis
  data. The inverting-amplifier example produced 321 real samples and four
  component measurement cards.
- The palette has a coherent neutral-black base, semantic status colors, a
  separate trace palette, SF Pro/SF Mono roles, and tokenized surfaces.

### P0/P1 usability problems

1. **Seeded demo masquerades as a project (P0).** Launch opens a hardcoded
   `Powerboard` tree and `inverting-amp.sim`, which obscures the real folder/ASC
   mental model and risks making Tau feel like a demo.
2. **ASC save corruption path (P0).** Opening an `.asc` retains its path but
   changes the tab title to `.sim`; Save serializes Tau JSON to that `.asc` path.
   This must be fixed before `.asc` can be called first-class.
3. **Telemetry requires horizontal scrolling (P1).** At 900×600,
   `.telemetry-strip` measured 872 px of content inside a 281 px viewport. Only
   the first card and part of the second are visible, directly violating the
   “all primary data visible” requirement.
4. **No useful first plot (P1).** A successful run presents a large empty card
   until a probe or node name exists. The guidance is correct, but the primary
   workspace feels broken. Provide direct “Probe on circuit” focus and a clear
   list of available named/probed signals; never fabricate a default trace.
5. **Circuit context collapses too far (P1).** At the minimum window the circuit
   column is about 306 px wide and shares its height with telemetry, shrinking
   the actual topology to a small island. Telemetry should reflow below/alongside
   plots rather than consume the circuit's primary vertical context.

### Visual consistency problems

6. The base is coherent but almost entirely opaque and flat. Add material only
   to the title/mode strip, floating zoom cluster, transient menus, and popovers;
   keep schematic/plot/data cards opaque.
7. UI copy and engineering values are both frequently rendered as small mono
   text. Reserve mono for domain values; promote panel titles, instructions, and
   button labels to SF Pro at 12–13 px.
8. Some controls still mix Lucide, Unicode (`+`, `−`, `⌂`, `›`), and text glyphs.
   Migrate them to one accessible icon-button primitive.
9. The analysis rail in the supplied screenshot is visually oversized and
   distributes short labels across a large pill. The compact implementation
   target is content-sized, 28–32 px high, quiet inactive labels, and a restrained
   selected segment — never a full-width billboard.
10. Empty and advanced states use large unused black areas without local actions
    or hierarchy. A plot/dashboard should read as a prepared instrument even
    before data exists: title, signal source, shortcut, and next action.

## 11. Implementation status — 2026-07-14

Landed and independently reviewed:

- ASC-native Schematics-folder startup with no seeded Powerboard/examples.
- Valid `.asc` creation, real-name import, multi-encoding reads, legacy `.sim`
  compatibility, collision/path safety, and pre-write loss-awareness gates.
- Content-sized 32px analysis rail with all seven directive modes visible at
  the 300px analysis floor.
- Reusable 28px Lucide instrument controls for plot zoom/fit.
- One selectable V/I/P component telemetry dock. Cards reflow vertically at the
  900×600 floor; measured horizontal overflow is zero, and dock height is capped
  to retain meaningful circuit context.
- Warm ice/graphite interaction chrome replaces cobalt selection blue; the trace
  palette remains independently color-coded. Primary primitives use the paired
  dark foreground token for 12.5:1 contrast.
- Every analysis abbreviation now has a concise purpose statement. Dedicated AC
  sources identify as sine sources, generic repeating results identify as
  periodic, and the redundant plotter close button is gone.
- A clean Errors state is a static 28px line instead of an expandable green
  banner. Real warnings/errors keep amber/red semantics. Canvas delete moved
  from a floating overlay to the stable toolbar while the Delete key remains.
- Transient plots are unfilled engineering traces. Full Home fit and
  visible-window Y autoscale are separate controls, and dense waveforms retain
  pulse extrema through min/max envelope reduction instead of becoming a solid
  polygon.
- Components and Assistant coexist as independent sibling columns, with a
  deterministic 900px fallback that never overlays the editor. The Assistant
  receives the active ASC privately and may propose a validated, confirmed,
  undoable current-document replacement without writing files or bypassing
  Tau's connectivity rules.
- Local MLX is implemented behind a fixed-loopback native lifecycle with
  explicit model downloads. Qwen3 4B is the recommended default; circuit plans
  are compiled by Tau from legal catalog parts and nets rather than trusting raw
  ASC or coordinates from the model.
- Explorer moves survive native drag payload timing, refresh the destination,
  and round-trip files/folders between nested directories and the visible root;
  the duplicate open/import project footer remains removed while compact toolbar
  actions remain.

Next implementation slice: finish persistent plot resize/reorder and
`.plt`/image export, then widen the local plan compiler only when each added Tau
component has a lossless LTspice symbol round-trip. Tau intentionally blocks
lossy in-place saves for complex vendor ASC records until those records can be
preserved structurally.
